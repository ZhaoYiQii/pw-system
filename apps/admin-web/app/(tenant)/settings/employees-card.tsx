"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiFetch } from "../../_lib/api";

type TenantRole =
  | "TENANT_OWNER"
  | "TENANT_ADMIN"
  | "CUSTOMER_SERVICE"
  | "FINANCE"
  | "PLAYER"
  | "CUSTOMER";

interface Employee {
  id: string;
  username: string;
  status: "ACTIVE" | "DISABLED";
  roles: TenantRole[];
  createdAt: string;
}

interface Me {
  role: string;
  username: string;
  sub: string;
}

const ROLE_OPTIONS: Array<{ value: TenantRole; label: string; desc: string }> = [
  { value: "TENANT_OWNER", label: "店老板", desc: "全模块管理" },
  { value: "TENANT_ADMIN", label: "店长", desc: "经营与配置" },
  { value: "CUSTOMER_SERVICE", label: "客服", desc: "订单与派单" },
  { value: "FINANCE", label: "财务", desc: "结算与风控" },
  { value: "PLAYER", label: "陪玩", desc: "接单档案" },
  { value: "CUSTOMER", label: "老板/客户", desc: "客户档案" },
];

const ROLE_LABEL = Object.fromEntries(
  ROLE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<TenantRole, string>;

function roleLabel(role: string): string {
  return ROLE_LABEL[role as TenantRole] ?? role;
}

function EmployeeDialog({
  mode,
  employee,
  onClose,
}: {
  mode: "create" | "edit";
  employee: Employee | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(employee?.username ?? "");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<TenantRole[]>(
    employee?.roles ?? ["CUSTOMER_SERVICE"],
  );
  const [message, setMessage] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (!username.trim()) throw new Error("请输入用户名");
      if (roles.length === 0) throw new Error("至少选择一个角色");
      if (mode === "create" && password.length < 8)
        throw new Error("密码至少 8 位");
      if (mode === "create") {
        return apiFetch<Employee>("/api/v1/tenant/accounts", {
          method: "POST",
          body: JSON.stringify({ username, password, roles }),
        });
      }
      if (!employee) throw new Error("缺少员工信息");
      return apiFetch<Employee>(
        `/api/v1/tenant/accounts/${employee.id}/roles`,
        {
          method: "PATCH",
          body: JSON.stringify({ roles }),
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["settings", "employees"],
      });
      onClose();
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const toggleRole = (role: TenantRole) => {
    setRoles((prev) =>
      prev.includes(role)
        ? prev.filter((item) => item !== role)
        : [...prev, role],
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="employee-dialog-title"
    >
      <div className="w-full max-w-md rounded-lg border bg-white p-5 shadow-lg">
        <h2 id="employee-dialog-title" className="text-lg font-semibold">
          {mode === "create" ? "新建员工" : `编辑角色：${employee?.username}`}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          后端按角色权限矩阵校验；隐藏按钮不等于授权。
        </p>
        {message ? (
          <p className="mt-3 text-sm text-destructive">{message}</p>
        ) : null}
        <div className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">用户名</span>
            <Input
              value={username}
              disabled={mode === "edit"}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              placeholder="例如 service01"
            />
          </label>
          {mode === "create" ? (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">初始密码（≥8 位）</span>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>
          ) : null}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">角色</legend>
            <div className="flex flex-col gap-2">
              {ROLE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={roles.includes(option.value)}
                    onChange={() => toggleRole(option.value)}
                  />
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {option.desc}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function EmployeesCard() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<
    | { mode: "create"; employee: null }
    | { mode: "edit"; employee: Employee }
    | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: ["settings", "me"],
    queryFn: () => apiFetch<Me>("/api/v1/tenant/me"),
  });
  const employeesQuery = useQuery({
    queryKey: ["settings", "employees"],
    queryFn: () => apiFetch<Employee[]>("/api/v1/tenant/accounts"),
    enabled: meQuery.data?.role === "TENANT_OWNER",
  });

  const toggleStatus = useMutation({
    mutationFn: (employee: Employee) =>
      apiFetch<Employee>(`/api/v1/tenant/accounts/${employee.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: employee.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
        }),
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["settings", "employees"],
      }),
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const isOwner = meQuery.data?.role === "TENANT_OWNER";
  const forbidden =
    !!employeesQuery.error &&
    employeesQuery.error instanceof ApiError &&
    employeesQuery.error.status === 403;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>员工与角色</CardTitle>
            <CardDescription>
              员工账号、启停与角色分配；权限矩阵以后端角色定义为唯一事实。
            </CardDescription>
          </div>
          {isOwner ? (
            <Button
              size="sm"
              onClick={() => setDialog({ mode: "create", employee: null })}
            >
              新建员工
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {message ? (
          <p className="mb-3 text-sm text-destructive">{message}</p>
        ) : null}
        {!isOwner ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            仅店老板可管理员工与角色（当前角色：
            {meQuery.data?.role ?? "加载中…"}）。
          </p>
        ) : forbidden ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            当前账号无权读取员工列表（后端已拒绝）。
          </p>
        ) : employeesQuery.isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            加载中…
          </p>
        ) : employeesQuery.data?.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            暂无员工，点击右上角新建。
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(employeesQuery.data ?? []).map((employee: Employee) => (
                <TableRow key={employee.id}>
                  <TableCell className="font-medium">
                    {employee.username}
                    {meQuery.data?.sub === employee.id ? "（我）" : ""}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {employee.roles.map((role: TenantRole) => (
                        <Badge key={role} variant="outline">
                          {roleLabel(role)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        employee.status === "ACTIVE" ? "default" : "outline"
                      }
                    >
                      {employee.status === "ACTIVE" ? "启用" : "停用"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={meQuery.data?.sub === employee.id}
                        onClick={() => setDialog({ mode: "edit", employee })}
                      >
                        编辑角色
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          meQuery.data?.sub === employee.id ||
                          toggleStatus.isPending
                        }
                        onClick={() => toggleStatus.mutate(employee)}
                      >
                        {employee.status === "ACTIVE" ? "停用" : "启用"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialog ? (
        <EmployeeDialog
          mode={dialog.mode}
          employee={dialog.employee}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Card>
  );
}
