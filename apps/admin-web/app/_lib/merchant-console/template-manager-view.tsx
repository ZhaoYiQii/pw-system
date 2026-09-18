"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "../api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  archiveTemplate,
  copyTemplate,
  createTemplate,
  deleteTemplate,
  fetchTemplateDraft,
  fetchTemplateList,
  fetchTemplateVersions,
  publishTemplate,
  restoreTemplate,
  saveTemplateDraft,
  setDefaultTemplate,
  toTemplateApiError,
  unarchiveTemplate,
  type TemplateListPage,
  type TemplateStatusFilter,
} from "./template-api";
import { TemplateEditorContent } from "./template-editor-content";
import {
  collectDraftIssues,
  mapIssuesToLocation,
  type DraftIssue,
  type LocatedIssue,
} from "./template-binding";
import { announceIssue } from "./template-a11y";
import { previewTemplateDocument } from "./template-document-preview";
import {
  isDirty,
  toContractConfig,
  toDraftConfig,
  type DraftConfigV2,
} from "./template-draft-state";
import {
  TEMPLATE_LIST_SORTS,
  TEMPLATE_LIST_STATUSES,
  UNCLASSIFIED_GAME,
  buildTemplateListSearch,
  isUnclassified,
  parseTemplateListSearch,
  toListQuery,
  type TemplateListSearch,
  type TemplateTab,
} from "./template-list-state";
import {
  GAME_DISPATCH_TEMPLATE_V2_FEATURE,
  useTemplateV2Feature,
} from "./feature-flags";
import { useMerchantRole } from "./role-context";

type TemplateSummary = TemplateListPage["data"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STATUS_LABELS: Record<TemplateStatusFilter, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  UNPUBLISHED_CHANGES: "有未发布改动",
  ARCHIVED: "已归档",
};

const SORT_LABELS: Record<(typeof TEMPLATE_LIST_SORTS)[number], string> = {
  UPDATED_DESC: "最近修改",
  UPDATED_ASC: "最早修改",
  NAME_ASC: "名称 A→Z",
  LAST_USED_DESC: "最近使用",
};

const TAB_LABELS: Record<TemplateTab, string> = {
  content: "内容设计",
  binding: "业务绑定与计算",
  release: "发布设置与版本历史",
};

/** 算价配置不属于派单模板模块，只保留内容设计与发布两个 Tab。 */
const VISIBLE_TABS: readonly TemplateTab[] = ["content", "release"];

interface GameOption {
  id: string;
  name: string;
  enabled: boolean;
}

function statusBadgeVariant(status: TemplateStatusFilter) {
  if (status === "ARCHIVED") return "outline" as const;
  if (status === "UNPUBLISHED_CHANGES") return "secondary" as const;
  if (status === "PUBLISHED") return "secondary" as const;
  return "outline" as const;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TemplateManagerView() {
  const { role, ready, unauthorized } = useMerchantRole();
  const v2Feature = useTemplateV2Feature();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const search = useMemo<TemplateListSearch>(
    () => parseTemplateListSearch(searchParams?.toString() ?? ""),
    [searchParams],
  );

  const canView = role === "OWNER" || role === "ADMIN" || role === "CS";
  const canManage = role === "OWNER" || role === "ADMIN";

  const [draft, setDraft] = useState<DraftConfigV2 | null>(null);
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGameId, setNewGameId] = useState("");
  const [lastTrigger, setLastTrigger] = useState<HTMLElement | null>(null);
  const [sourceVersionId, setSourceVersionId] = useState<string | null>(null);
  const [publishIssues, setPublishIssues] = useState<DraftIssue[]>([]);
  const [conflict, setConflict] = useState<{
    expectedRevision: number;
    currentRevision: number;
    currentEditor: string | null;
    currentUpdatedAt: string | null;
    from: "save" | "publish" | "restore";
  } | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [copyTargetGameId, setCopyTargetGameId] = useState("");
  /** 隐藏左侧模板列表，把宽度让给编辑区。 */
  const [listHidden, setListHidden] = useState(false);
  const [copyName, setCopyName] = useState("");

  const updateSearch = useCallback(
    (patch: Partial<TemplateListSearch>) => {
      const next = buildTemplateListSearch({ ...search, ...patch });
      router.replace(`${pathname}${next}`, { scroll: false });
    },
    [pathname, router, search],
  );

  const gamesQuery = useQuery({
    queryKey: ["catalog-games"],
    queryFn: () => apiFetch<GameOption[]>("/api/v1/tenant/catalog/games"),
    enabled: canView,
    staleTime: 5 * 60_000,
  });

  const listQuery = useInfiniteQuery({
    queryKey: [
      "template-list",
      search.game,
      search.status,
      search.q,
      search.sort,
    ],
    enabled: canView,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchTemplateList(
        toListQuery(search, {
          limit: 30,
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      ),
    getNextPageParam: (lastPage) => lastPage.page.nextCursor,
  });

  const detailQuery = useQuery({
    queryKey: ["template-draft", search.id],
    enabled: canView && search.id !== null,
    queryFn: () => fetchTemplateDraft(search.id as string),
    retry: false,
  });

  const savedConfig = detailQuery.data?.config ?? null;
  const baselineKey = detailQuery.data
    ? `${detailQuery.data.id}:${detailQuery.data.revision}`
    : null;

  /** 定位到校验问题：切到对应标签，滚动并把焦点移到区块/组件。 */
  const locateIssue = useCallback(
    (issue: LocatedIssue) => {
      updateSearch({ tab: issue.tab === "binding" ? "content" : issue.tab });
      setNotice(announceIssue(issue));
      const selector = issue.componentKey
        ? `[data-component-key="${issue.componentKey}"]`
        : issue.sectionKey
          ? `[data-section-key="${issue.sectionKey}"]`
          : null;
      if (!selector) return;
      window.setTimeout(() => {
        const target = document.querySelector<HTMLElement>(selector);
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
        target?.focus();
      }, 50);
    },
    [updateSearch],
  );

  /** 服务端 revision 变化时重置本地草稿基线；编辑期间的后台刷新不会覆盖输入。 */
  useEffect(() => {
    setDraft(detailQuery.data ? toDraftConfig(detailQuery.data.config) : null);
  }, [baselineKey]);

  /**
   * 提示只在切换模板时清空。
   * 保存/发布会刷新 revision，若跟着 revision 一起清空，
   * 成功提示（含 aria-live 播报）会在同一帧被抹掉，用户与读屏都看不到。
   */
  useEffect(() => {
    setNotice("");
  }, [search.id]);

  const dirty =
    draft !== null && savedConfig !== null
      ? isDirty(toDraftConfig(savedConfig), draft)
      : false;
  const bindingIssueCount =
    draft === null ? 0 : collectDraftIssues(draft).length;
  /** Task 3 会用真实草稿模型替换 dirty 的写入方；这里先把守卫接好。 */
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const confirmDiscard = useCallback((): boolean => {
    if (!dirty) return true;
    return window.confirm("当前模板有未保存的修改，确定放弃并切换吗？");
  }, [dirty]);

  const createMutation = useMutation({
    mutationFn: () =>
      createTemplate({
        gameId: newGameId,
        name: newName.trim(),
        description: null,
      }),
    onSuccess: (created) => {
      setCreateOpen(false);
      setNewName("");
      setNewGameId("");
      void queryClient.invalidateQueries({ queryKey: ["template-list"] });
      updateSearch({
        id: created.id,
        tab: "content",
        game: "all",
        status: "all",
      });
    },
  });

  const versionsQuery = useInfiniteQuery({
    queryKey: ["template-versions", search.id],
    enabled: canView && search.id !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchTemplateVersions(search.id as string, {
        limit: 20,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (lastPage) => lastPage.page.nextCursor,
  });

  const templateId = search.id;
  const serverRevision = detailQuery.data?.revision ?? null;
  const isArchived = detailQuery.data?.status === "ARCHIVED";

  const refreshTemplate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["template-draft", templateId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["template-versions", templateId],
    });
    void queryClient.invalidateQueries({ queryKey: ["template-list"] });
  }, [queryClient, templateId]);

  const handleMutationError = useCallback(
    (error: unknown, from: "save" | "publish" | "restore") => {
      const apiError = toTemplateApiError(error);
      if (
        apiError.code === "TEMPLATE_REVISION_CONFLICT" &&
        isRecord(apiError.details)
      ) {
        const details = apiError.details;
        setConflict({
          expectedRevision:
            typeof details.expectedRevision === "number"
              ? details.expectedRevision
              : 0,
          currentRevision:
            typeof details.currentRevision === "number"
              ? details.currentRevision
              : 0,
          currentEditor:
            typeof details.currentEditor === "string"
              ? details.currentEditor
              : null,
          currentUpdatedAt:
            typeof details.currentUpdatedAt === "string"
              ? details.currentUpdatedAt
              : null,
          from,
        });
        return;
      }
      if (from === "publish" && apiError.issueList().length > 0 && draft) {
        setPublishIssues(
          collectDraftIssues(draft).concat(
            apiError.issueList().map((issue) => ({
              code: "TEMPLATE_COMPONENT_INVALID" as const,
              path: issue.path ?? "$",
              ...(issue.componentKey === undefined
                ? {}
                : { componentKey: issue.componentKey }),
              message: issue.message ?? apiError.message,
            })),
          ),
        );
      }
      setNotice(`${apiError.message}（${apiError.code}）`);
    },
    [draft],
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      saveTemplateDraft(templateId as string, {
        expectedRevision: serverRevision as number,
        config: toContractConfig(draft as DraftConfigV2),
      }),
    onSuccess: (result) => {
      setNotice(`草稿已保存 · r${result.revision}`);
      setPublishIssues([]);
      refreshTemplate();
    },
    onError: (error) => handleMutationError(error, "save"),
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      publishTemplate(templateId as string, {
        expectedRevision: serverRevision as number,
        changeNote: changeNote.trim() === "" ? null : changeNote.trim(),
        sourceVersionId,
      }),
    onSuccess: (view) => {
      setNotice(
        view.activeVersionNo === null
          ? "已发布"
          : `已发布 v${view.activeVersionNo}`,
      );
      setPublishIssues([]);
      setSourceVersionId(null);
      setChangeNote("");
      refreshTemplate();
    },
    onError: (error) => handleMutationError(error, "publish"),
  });

  const restoreMutation = useMutation({
    mutationFn: (versionId: string) =>
      restoreTemplate(templateId as string, {
        versionId,
        expectedRevision: serverRevision as number,
      }),
    onSuccess: (result) => {
      setDraft(toDraftConfig(result.config));
      setSourceVersionId(result.sourceVersionId);
      setNotice("已把历史版本还原为草稿（线上版本未变，发布后才生效）");
      refreshTemplate();
    },
    onError: (error) => handleMutationError(error, "restore"),
  });

  const lifecycleMutation = useMutation({
    mutationFn: async (
      action: "default" | "archive" | "unarchive" | "delete",
    ) => {
      const id = templateId as string;
      const revision = serverRevision as number;
      if (action === "default") return setDefaultTemplate(id, revision);
      if (action === "archive") return archiveTemplate(id, revision);
      if (action === "unarchive") return unarchiveTemplate(id, revision);
      return deleteTemplate(id, revision);
    },
    onSuccess: (_result, action) => {
      setNotice(
        action === "default"
          ? "已设为该游戏默认模板"
          : action === "archive"
            ? "已归档 · 历史订单不受影响"
            : action === "unarchive"
              ? "已取消归档"
              : "模板已删除",
      );
      if (action === "delete") {
        updateSearch({ id: null, tab: "content" });
      }
      refreshTemplate();
    },
    onError: (error) => setNotice(toTemplateApiError(error).message),
  });

  const copyMutation = useMutation({
    mutationFn: () =>
      copyTemplate(templateId as string, {
        targetGameId: copyTargetGameId,
        newName: copyName.trim(),
      }),
    onSuccess: (created) => {
      setNotice(`已复制为「${created.name}」（独立草稿，不含版本与默认状态）`);
      setCopyName("");
      void queryClient.invalidateQueries({ queryKey: ["template-list"] });
    },
    onError: (error) => setNotice(toTemplateApiError(error).message),
  });

  const draftPreview = useMemo(
    () => (draft === null ? null : previewTemplateDocument(draft)),
    [draft],
  );
  const allIssues = useMemo(
    () =>
      draft === null
        ? []
        : mapIssuesToLocation(
            draft,
            collectDraftIssues(draft).concat(publishIssues),
          ),
    [draft, publishIssues],
  );

  const canSave =
    canManage &&
    !isArchived &&
    dirty &&
    serverRevision !== null &&
    !saveMutation.isPending;
  const canPublish =
    canManage &&
    !isArchived &&
    serverRevision !== null &&
    !dirty &&
    !publishMutation.isPending;

  const loadedItems = useMemo(
    () => listQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [listQuery.data],
  );
  // 未归类由服务端按 gameScope=UNCLASSIFIED 过滤（分页下才正确），
  // 这里不再做客户端筛选；isUnclassified 仍用于展示"未归类"标记。
  const visibleItems = loadedItems;

  const games = gamesQuery.data ?? [];
  const gameNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const game of games) map.set(game.id, game.name);
    return map;
  }, [games]);

  const createError = createMutation.error
    ? toTemplateApiError(createMutation.error)
    : null;
  const listError = listQuery.error
    ? toTemplateApiError(listQuery.error)
    : null;
  const detailError = detailQuery.error
    ? toTemplateApiError(detailQuery.error)
    : null;

  const selectTemplate = (template: TemplateSummary) => {
    if (template.id === search.id) return;
    if (!confirmDiscard()) return;
    updateSearch({ id: template.id, tab: "content" });
  };

  if (!ready) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        正在加载门店身份…
      </p>
    );
  }

  if (unauthorized) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <h1 className="text-lg font-semibold">尚未登录门店账号</h1>
          <p className="text-sm text-muted-foreground">
            模板管理需要门店账号与对应权限。
          </p>
          <Button asChild>
            <a href="/store/login">去登录</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (v2Feature.ready && !v2Feature.enabled) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          <h1 className="text-base font-semibold">
            该门店尚未开通通用派单模板
          </h1>
          <p className="text-sm text-muted-foreground">
            需要平台开通能力位
            <code className="font-mono text-xs">
              {GAME_DISPATCH_TEMPLATE_V2_FEATURE}
            </code>
            ，开通后本页可用。
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!canView) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          <h1 className="text-lg font-semibold">无权查看模板管理 · 403</h1>
          <p className="text-sm text-muted-foreground">
            当前角色没有模板查看权限；界面隐藏不等于授权，服务端仍会拒绝访问。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="mc-pagehead">
        <div>
          <h1>派单模板</h1>
          <p className="text-sm text-muted-foreground">
            按游戏维护派单表单；保存草稿不影响线上，发布后新版本才生效。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            aria-pressed={listHidden}
            aria-controls="tpl-list"
            onClick={() => setListHidden((value) => !value)}
          >
            {listHidden ? "显示模板列表" : "隐藏模板列表"}
          </Button>
          {canManage ? (
            <Button
              onClick={(event) => {
                setLastTrigger(event.currentTarget);
                setCreateOpen(true);
              }}
            >
              新建模板
            </Button>
          ) : (
            <Badge variant="secondary">客服只读</Badge>
          )}
        </div>
      </header>

      <section
        aria-label="筛选与排序"
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          游戏
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={search.game}
            onChange={(event) => {
              if (!confirmDiscard()) return;
              updateSearch({ game: event.target.value, id: null });
            }}
          >
            <option value="all">全部</option>
            <option value={UNCLASSIFIED_GAME}>未归类（旧模板）</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
                {game.enabled ? "" : "（已停用）"}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          状态
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={search.status}
            onChange={(event) =>
              updateSearch({
                status: event.target.value as TemplateListSearch["status"],
                id: null,
              })
            }
          >
            <option value="all">全部状态</option>
            {TEMPLATE_LIST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          排序
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={search.sort}
            onChange={(event) =>
              updateSearch({
                sort: event.target.value as TemplateListSearch["sort"],
                id: null,
              })
            }
          >
            {TEMPLATE_LIST_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          搜索
          <Input
            value={search.q}
            placeholder="按模板名称或说明搜索"
            onChange={(event) =>
              updateSearch({ q: event.target.value, id: null })
            }
          />
        </label>
      </section>

      {search.game === UNCLASSIFIED_GAME ? (
        <p className="text-xs text-muted-foreground" role="note">
          未归类筛选在已加载的 {loadedItems.length}{" "}
          条内完成；契约暂不支持按“未归类”查询， 继续加载可减少遗漏。
        </p>
      ) : null}

      <div
        className={`mc-tpl-layout grid gap-6 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]${
          listHidden ? " is-list-hidden" : ""
        }`}
      >
        <section aria-label="模板列表" id="tpl-list" className="space-y-3">
          {listQuery.isPending ? (
            <div className="space-y-3" role="status" aria-live="polite">
              <div className="h-20 animate-pulse rounded-xl border bg-muted" />
              <div className="h-20 animate-pulse rounded-xl border bg-muted" />
              <p className="text-xs text-muted-foreground">正在加载模板…</p>
            </div>
          ) : null}

          {listError ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <h2 className="font-semibold">模板列表加载失败</h2>
                <p className="text-sm text-muted-foreground">
                  {listError.message}（{listError.code}）
                </p>
                <Button
                  variant="outline"
                  onClick={() => void listQuery.refetch()}
                >
                  重试
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {!listQuery.isPending && !listError && visibleItems.length === 0 ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <h2 className="font-semibold">这个条件下还没有模板</h2>
                <p className="text-sm text-muted-foreground">
                  新建一份模板，把要问客户的内容编进去。
                </p>
                {canManage ? (
                  <Button onClick={() => setCreateOpen(true)}>新建模板</Button>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {visibleItems.map((template) => {
            const selected = template.id === search.id;
            return (
              <button
                key={template.id}
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => selectTemplate(template)}
                className={`w-full rounded-xl border bg-card p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                  selected
                    ? "border-primary bg-accent/40"
                    : "hover:bg-accent/20"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{template.name}</span>
                  <Badge variant={statusBadgeVariant(template.status)}>
                    {STATUS_LABELS[template.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isUnclassified(template)
                    ? "未归类（旧模板）"
                    : (gameNameById.get(template.game.id) ??
                      template.game.name)}
                  {template.isDefault ? " · 默认" : ""}
                  {template.hasUnpublishedChanges ? " · 有未发布改动" : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-mono">
                    {template.activeVersionNo === null
                      ? "未发布"
                      : `v${template.activeVersionNo}`}{" "}
                    · r{template.revision}
                  </span>
                  {" · "}
                  {template.updatedBy ?? "—"} ·{" "}
                  {formatDateTime(template.updatedAt)}
                </p>
              </button>
            );
          })}

          {listQuery.hasNextPage ? (
            <Button
              variant="outline"
              className="w-full"
              disabled={listQuery.isFetchingNextPage}
              onClick={() => void listQuery.fetchNextPage()}
            >
              {listQuery.isFetchingNextPage ? "加载中…" : "加载更多"}
            </Button>
          ) : null}
        </section>

        <section aria-label="模板详情" className="space-y-4">
          {search.id === null ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                从左侧选择一个模板查看草稿、线上版本与版本历史。
              </CardContent>
            </Card>
          ) : null}

          {search.id !== null && detailQuery.isPending ? (
            <Card>
              <CardContent
                className="p-6 text-sm text-muted-foreground"
                role="status"
              >
                正在加载模板详情…
              </CardContent>
            </Card>
          ) : null}

          {detailError ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <h2 className="font-semibold">模板不可读取</h2>
                <p className="text-sm text-muted-foreground">
                  {detailError.message}（{detailError.code}）
                </p>
              </CardContent>
            </Card>
          ) : null}

          {detailQuery.data ? (
            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {detailQuery.data.name}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {detailQuery.data.description ?? "（无说明）"}
                    </p>
                  </div>
                  <Badge variant={statusBadgeVariant(detailQuery.data.status)}>
                    {STATUS_LABELS[detailQuery.data.status]}
                  </Badge>
                </div>

                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">线上版本</dt>
                    <dd className="font-mono">
                      {detailQuery.data.activeVersion === null
                        ? "未发布"
                        : `v${detailQuery.data.activeVersion.versionNo}`}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">草稿修订</dt>
                    <dd className="font-mono">r{detailQuery.data.revision}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">最后编辑人</dt>
                    <dd>{detailQuery.data.updatedBy ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">未发布改动</dt>
                    <dd>
                      {detailQuery.data.hasUnpublishedChanges ? "有" : "无"}
                    </dd>
                  </div>
                </dl>

                {isUnclassified(detailQuery.data) ? (
                  <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                    未归类（旧模板）：指定游戏后才能发布新版本。
                  </p>
                ) : null}

                <div
                  role="tablist"
                  aria-label="编辑标签"
                  className="flex gap-2 border-b pb-2"
                >
                  {VISIBLE_TABS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={search.tab === tab}
                      className={`rounded-md px-3 py-1 text-sm ${
                        search.tab === tab
                          ? "bg-secondary font-medium"
                          : "text-muted-foreground hover:bg-accent/30"
                      }`}
                      onClick={() => updateSearch({ tab })}
                    >
                      {TAB_LABELS[tab]}
                      {tab === "binding" && bindingIssueCount > 0 ? (
                        <span className="ml-1 font-mono text-[11px] text-destructive">
                          {bindingIssueCount}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={!canSave}
                    title={
                      isArchived
                        ? "模板已归档，不能保存草稿"
                        : !dirty
                          ? "没有未保存的改动"
                          : undefined
                    }
                    onClick={() => saveMutation.mutate()}
                  >
                    {saveMutation.isPending ? "保存中…" : "保存草稿"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!canPublish}
                    title={
                      isArchived
                        ? "模板已归档，不能发布"
                        : dirty
                          ? "先保存草稿再发布"
                          : undefined
                    }
                    onClick={() => {
                      setPublishIssues([]);
                      publishMutation.mutate();
                    }}
                  >
                    {publishMutation.isPending ? "发布中…" : "发布"}
                  </Button>
                  {dirty ? <Badge variant="secondary">未保存改动</Badge> : null}
                  {allIssues.length > 0 ? (
                    <Badge variant="destructive">
                      {allIssues.length} 个校验问题
                    </Badge>
                  ) : null}
                  {isArchived ? <Badge variant="outline">已归档</Badge> : null}
                  <span
                    className="text-xs text-muted-foreground"
                    role="status"
                    aria-live="polite"
                  >
                    {notice}
                  </span>
                </div>

                {conflict ? (
                  <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                    <p className="text-sm font-medium">
                      另一个管理员刚保存过（{conflict.currentEditor ?? "未知"} ·{" "}
                      {conflict.currentUpdatedAt ?? "时间未知"}）：服务端 r
                      {conflict.currentRevision}，你手上是 r
                      {conflict.expectedRevision}。
                    </p>
                    <p className="text-xs text-muted-foreground">
                      你的改动还在本地，不会被自动覆盖。选择重新加载服务端，或先复制我的内容再决定。
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setConflict(null);
                          refreshTemplate();
                          setNotice("已重新加载服务端草稿");
                        }}
                      >
                        重新加载服务端
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void navigator.clipboard
                            ?.writeText(JSON.stringify(draft, null, 2))
                            .then(() => setNotice("已复制本地草稿内容到剪贴板"))
                            .catch(() =>
                              setNotice(
                                "复制失败：浏览器未授权剪贴板，请手动复制预览内容",
                              ),
                            );
                        }}
                      >
                        复制我的内容
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConflict(null)}
                      >
                        稍后处理
                      </Button>
                    </div>
                  </div>
                ) : null}

                {search.tab === "content" || search.tab === "binding" ? (
                  draft ? (
                    <div className="space-y-4">
                      <TemplateEditorContent
                        draft={draft}
                        onChange={setDraft}
                        onNotice={setNotice}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      正在准备草稿…
                    </p>
                  )
                ) : null}

                {search.tab === "release" ? (
                  <div className="space-y-5">
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold">发布备注</h3>
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        本次发布说明（可选，会记入版本历史）
                        <Input
                          className="h-9"
                          maxLength={500}
                          value={changeNote}
                          placeholder="例如：新增段位加价"
                          onChange={(event) =>
                            setChangeNote(event.target.value)
                          }
                        />
                      </label>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold">校验问题</h3>
                      {allIssues.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          当前草稿通过即时校验；发布时服务端仍会再校验一次。
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {allIssues.map((issue, index) => (
                            <li
                              key={`${issue.code}-${index}`}
                              className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2 text-xs"
                            >
                              <Badge variant="outline">{issue.code}</Badge>
                              <span className="flex-1">{issue.message}</span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => locateIssue(issue)}
                              >
                                定位
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold">
                        版本历史
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          游标分页 · 每页 20
                        </span>
                      </h3>
                      {versionsQuery.isPending ? (
                        <p className="text-xs text-muted-foreground">
                          正在加载版本…
                        </p>
                      ) : null}
                      {versionsQuery.data?.pages
                        .flatMap((page) => page.data)
                        .map((version) => (
                          <div
                            key={version.id}
                            className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs"
                            data-version-no={version.versionNo}
                          >
                            <span className="font-mono">
                              v{version.versionNo}
                            </span>
                            <span className="text-muted-foreground">
                              {formatDateTime(version.publishedAt)} ·{" "}
                              {version.publishedBy || "系统"}
                            </span>
                            {version.schemaVersion === 1 ? (
                              <Badge variant="outline">只读历史</Badge>
                            ) : null}
                            {version.changeNote ? (
                              <span>{version.changeNote}</span>
                            ) : null}
                            <span className="ml-auto flex gap-2">
                              {version.schemaVersion === 1 ? (
                                <span className="text-muted-foreground">
                                  不可恢复
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    !canManage || restoreMutation.isPending
                                  }
                                  onClick={() =>
                                    restoreMutation.mutate(version.id)
                                  }
                                >
                                  恢复到此
                                </Button>
                              )}
                            </span>
                          </div>
                        ))}
                      {versionsQuery.hasNextPage ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={versionsQuery.isFetchingNextPage}
                          onClick={() => void versionsQuery.fetchNextPage()}
                        >
                          {versionsQuery.isFetchingNextPage
                            ? "加载中…"
                            : "加载更多版本"}
                        </Button>
                      ) : null}
                      {versionsQuery.data?.pages.flatMap((page) => page.data)
                        .length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          还没有发布版本。保存草稿不影响线上，发布后才会生成
                          v1。
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        恢复是把历史版本写回草稿，线上版本不变；发布时会把
                        {sourceVersionId
                          ? " 当前溯源版本 "
                          : "（可选）溯源版本 "}
                        记入版本记录。
                      </p>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold">
                        文案预览（按当前草稿）
                      </h3>
                      {draftPreview ? (
                        <>
                          <div className="overflow-hidden rounded-md border">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-muted">
                                <tr>
                                  <th className="px-2 py-1 font-medium">
                                    区块
                                  </th>
                                  <th className="px-2 py-1 font-medium">
                                    字段
                                  </th>
                                  <th className="px-2 py-1 font-medium">值</th>
                                </tr>
                              </thead>
                              <tbody>
                                {draftPreview.rows.map((row, index) => (
                                  <tr key={`${row.fieldLabel}-${index}`}>
                                    <td className="px-2 py-1 text-muted-foreground">
                                      {row.sectionLabel}
                                    </td>
                                    <td className="px-2 py-1">
                                      {row.fieldLabel}
                                    </td>
                                    <td className="px-2 py-1">
                                      {row.value}
                                      {row.note ? (
                                        <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                                          {row.note}
                                        </span>
                                      ) : null}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
                            {draftPreview.plainText || "（还没有可生成的内容）"}
                          </pre>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void navigator.clipboard
                                ?.writeText(draftPreview.plainText)
                                .then(() => setNotice("已复制预览文案"))
                                .catch(() =>
                                  setNotice("复制失败：浏览器未授权剪贴板"),
                                );
                            }}
                          >
                            复制预览文案
                          </Button>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          正在准备预览…
                        </p>
                      )}
                    </section>

                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold">次级操作</h3>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !canManage ||
                            isArchived ||
                            lifecycleMutation.isPending
                          }
                          onClick={() => lifecycleMutation.mutate("default")}
                          title={
                            isArchived ? "归档模板不能设为默认" : undefined
                          }
                        >
                          设为默认
                        </Button>
                        {isArchived ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canManage || lifecycleMutation.isPending}
                            onClick={() =>
                              lifecycleMutation.mutate("unarchive")
                            }
                          >
                            取消归档
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canManage || lifecycleMutation.isPending}
                            onClick={() => lifecycleMutation.mutate("archive")}
                          >
                            归档
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !canManage ||
                            isArchived ||
                            lifecycleMutation.isPending
                          }
                          onClick={() => {
                            if (
                              window.confirm(
                                "删除只允许从未发布且无引用的模板；已发布会提示改为归档。确定尝试删除吗？",
                              )
                            ) {
                              lifecycleMutation.mutate("delete");
                            }
                          }}
                        >
                          删除
                        </Button>
                      </div>

                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                          复制到游戏
                          <select
                            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                            value={copyTargetGameId}
                            onChange={(event) =>
                              setCopyTargetGameId(event.target.value)
                            }
                          >
                            <option value="">请选择目标游戏</option>
                            {games.map((game) => (
                              <option key={game.id} value={game.id}>
                                {game.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                          新模板名称
                          <Input
                            className="h-9 w-56"
                            value={copyName}
                            maxLength={60}
                            onChange={(event) =>
                              setCopyName(event.target.value)
                            }
                          />
                        </label>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !canManage ||
                            copyTargetGameId === "" ||
                            copyName.trim() === "" ||
                            copyMutation.isPending
                          }
                          onClick={() => copyMutation.mutate()}
                        >
                          {copyMutation.isPending
                            ? "复制中…"
                            : "复制为独立草稿"}
                        </Button>
                      </div>
                    </section>
                  </div>
                ) : null}

                <p className="text-xs text-muted-foreground">
                  复制文案（copyLines）已从新编辑器移除；派单文案将由发布快照自动生成。
                </p>
              </CardContent>
            </Card>
          ) : null}
        </section>
      </div>

      {createOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setCreateOpen(false);
              lastTrigger?.focus();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-template-title"
            className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg"
          >
            <h2 id="create-template-title" className="text-lg font-semibold">
              新建模板
            </h2>
            <div className="mt-4 space-y-4">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                游戏（必选）
                <select
                  autoFocus
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={newGameId}
                  onChange={(event) => setNewGameId(event.target.value)}
                >
                  <option value="">请选择游戏</option>
                  {games.map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                模板名称
                <Input
                  value={newName}
                  maxLength={60}
                  placeholder="例如：排位陪练 · 标准版"
                  onChange={(event) => setNewName(event.target.value)}
                />
              </label>
              {createError ? (
                <p className="text-sm text-destructive" role="alert">
                  {createError.message}（{createError.code}）
                </p>
              ) : null}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCreateOpen(false);
                  lastTrigger?.focus();
                }}
              >
                取消
              </Button>
              <Button
                disabled={
                  createMutation.isPending ||
                  newGameId === "" ||
                  newName.trim() === ""
                }
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? "创建中…" : "创建模板"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
