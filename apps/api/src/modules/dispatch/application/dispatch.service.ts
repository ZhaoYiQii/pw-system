import type {
  ApplicationView,
  AssignView,
  HallOrderView,
} from "../domain/dispatch.js";

export interface DispatchRepository {
  publish(tenantId: string, orderId: string, actorId: string): Promise<void>;
  hallOrders(tenantId: string): Promise<HallOrderView[]>;
  apply(
    tenantId: string,
    orderId: string,
    playerId: string,
    actorId: string,
    note?: string | null,
  ): Promise<void>;
  myApplications(
    tenantId: string,
    playerId: string,
  ): Promise<ApplicationView[]>;
  applications(tenantId: string, orderId: string): Promise<ApplicationView[]>;
  shortlist(
    tenantId: string,
    orderId: string,
    applicationId: string,
    shortlisted: boolean,
    actorId: string,
  ): Promise<void>;
  assign(
    tenantId: string,
    orderId: string,
    applicationId: string,
    actorId: string,
  ): Promise<AssignView>;
}

export class DispatchService {
  constructor(private readonly repository: DispatchRepository) {}

  async publish(
    tenantId: string,
    orderId: string,
    actorId: string,
  ): Promise<void> {
    await this.repository.publish(tenantId, orderId, actorId);
  }

  async hallOrders(tenantId: string): Promise<HallOrderView[]> {
    return this.repository.hallOrders(tenantId);
  }

  async apply(
    tenantId: string,
    orderId: string,
    playerId: string,
    actorId: string,
    note?: string | null,
  ): Promise<void> {
    await this.repository.apply(tenantId, orderId, playerId, actorId, note);
  }

  async myApplications(
    tenantId: string,
    playerId: string,
  ): Promise<ApplicationView[]> {
    return this.repository.myApplications(tenantId, playerId);
  }

  async applications(
    tenantId: string,
    orderId: string,
  ): Promise<ApplicationView[]> {
    return this.repository.applications(tenantId, orderId);
  }

  async shortlist(
    tenantId: string,
    orderId: string,
    applicationId: string,
    shortlisted: boolean,
    actorId: string,
  ): Promise<void> {
    await this.repository.shortlist(
      tenantId,
      orderId,
      applicationId,
      shortlisted,
      actorId,
    );
  }

  async assign(
    tenantId: string,
    orderId: string,
    applicationId: string,
    actorId: string,
  ): Promise<AssignView> {
    return this.repository.assign(tenantId, orderId, applicationId, actorId);
  }
}
