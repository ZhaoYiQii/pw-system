export type ActiveStatus = "ACTIVE" | "INACTIVE";

export interface CustomerView {
  id: string;
  tenantId: string;
  name: string;
  mobile: string | null;
  remark: string | null;
  status: ActiveStatus;
  createdAt: Date;
  updatedAt: Date;
}