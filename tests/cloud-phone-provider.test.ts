import { describe, expect, it, vi } from "vitest";
import { createAliyunCloudPhoneProviderFromEnv } from "../server/cloud-phone/providers/aliyun-cloud-phone-provider";

describe("createAliyunCloudPhoneProviderFromEnv", () => {
  it("accepts the local ALIYUN_* environment variable aliases", () => {
    expect(() =>
      createAliyunCloudPhoneProviderFromEnv({
        ALIYUN_ACCESS_KEY_ID: "id",
        ALIYUN_ACCESS_KEY_SECRET: "secret",
        ALIYUN_CLOUD_PHONE_INSTANCE_ID: "acp-test",
        ALIYUN_REGION_ID: "cn-shanghai",
      }),
    ).not.toThrow();
  });

  it("keeps cloud-phone credentials separate from knowledge-base credentials", () => {
    const provider = createAliyunCloudPhoneProviderFromEnv({
      ALIYUN_ACCESS_KEY_ID: "phone-id",
      ALIYUN_ACCESS_KEY_SECRET: "phone-secret",
      ALIYUN_CLOUD_PHONE_INSTANCE_ID: "acp-phone",
      ALIYUN_REGION_ID: "cn-shanghai",
      ALIBABA_CLOUD_ACCESS_KEY_ID: "knowledge-id",
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: "knowledge-secret",
      ALIYUN_INSTANCE_ID: "acp-old",
      ALIBABA_CLOUD_REGION_ID: "cn-beijing",
    });

    expect((provider as unknown as { config: Record<string, string> }).config).toMatchObject({
      accessKeyId: "phone-id",
      accessKeySecret: "phone-secret",
      instanceId: "acp-phone",
      regionId: "cn-shanghai",
    });
  });

  it("reports missing required cloud phone config before making provider calls", () => {
    expect(() => createAliyunCloudPhoneProviderFromEnv({ ALIYUN_ACCESS_KEY_ID: "id" })).toThrow("云手机配置不完整");
  });

  it("reads device data from the OpenAPI response body", async () => {
    const provider = createAliyunCloudPhoneProviderFromEnv({
      ALIYUN_ACCESS_KEY_ID: "id",
      ALIYUN_ACCESS_KEY_SECRET: "secret",
      ALIYUN_CLOUD_PHONE_INSTANCE_ID: "acp-test",
      ALIYUN_REGION_ID: "cn-shanghai",
    });
    const client = (provider as unknown as { client: { callApi: (...args: unknown[]) => Promise<unknown> } }).client;
    vi.spyOn(client, "callApi").mockResolvedValue({ body: { Data: [{ InstanceId: "acp-test", Status: "RUNNING" }] } });

    const devices = await provider.describeDevices();

    expect(devices).toMatchObject([{ instanceId: "acp-test", runtimeStatus: "RUNNING" }]);
  });

  it("lists only configured devices when multiple instance IDs are supplied", async () => {
    const provider = createAliyunCloudPhoneProviderFromEnv({
      ALIYUN_ACCESS_KEY_ID: "id", ALIYUN_ACCESS_KEY_SECRET: "secret",
      ALIYUN_CLOUD_PHONE_INSTANCE_IDS: "acp-a,acp-b", ALIYUN_REGION_ID: "cn-shanghai",
    });
    const client = (provider as unknown as { client: { callApi: (...args: unknown[]) => Promise<unknown> } }).client;
    const callApi = vi.spyOn(client, "callApi").mockResolvedValue({ body: { Data: [
      { InstanceId: "acp-a", Status: "RUNNING" }, { InstanceId: "acp-b", Status: "STOPPED" }, { InstanceId: "acp-other", Status: "RUNNING" },
    ] } });
    expect((await provider.describeDevices()).map((item) => item.instanceId)).toEqual(["acp-a", "acp-b"]);
    expect(callApi.mock.calls[0][1]).toMatchObject({ query: { "InstanceIds.1": "acp-a", "InstanceIds.2": "acp-b" } });
  });

  it("reads command output through RunCommand and DescribeInvocations without Agent tasks", async () => {
    const provider = createAliyunCloudPhoneProviderFromEnv({ ALIYUN_ACCESS_KEY_ID: "id", ALIYUN_ACCESS_KEY_SECRET: "secret", ALIYUN_CLOUD_PHONE_INSTANCE_ID: "acp-a" });
    const client = (provider as unknown as { client: { callApi: (...args: unknown[]) => Promise<unknown> } }).client;
    const callApi = vi.spyOn(client, "callApi").mockResolvedValueOnce({ body: { InvokeId: "invoke-1" } }).mockResolvedValueOnce({ body: { Data: [{ InstanceId: "acp-a", InvocationStatus: "Success", Output: "real device output" }] } });
    const output = await provider.runReadOnlyCommand({ id: "acp-a", instanceId: "acp-a", name: "phone", tenantId: "local", runtimeStatus: "RUNNING", occupancyStatus: "IDLE" }, "dumpsys notification --noredact");
    expect(output).toBe("real device output");
    expect(callApi.mock.calls.map((call) => (call[0] as { action: string }).action)).toEqual(["RunCommand", "DescribeInvocations"]);
  });

  it("requests a connection ticket with only the verified instance parameter", async () => {
    const provider = createAliyunCloudPhoneProviderFromEnv({
      ALIYUN_ACCESS_KEY_ID: "id",
      ALIYUN_ACCESS_KEY_SECRET: "secret",
      ALIYUN_CLOUD_PHONE_INSTANCE_ID: "acp-test",
      ALIYUN_REGION_ID: "cn-shanghai",
    });
    const client = (provider as unknown as { client: { callApi: (...args: unknown[]) => Promise<unknown> } }).client;
    const callApi = vi.spyOn(client, "callApi").mockResolvedValue({
      body: { InstanceConnectionModels: [{ InstanceId: "acp-test", Ticket: "test-ticket" }] },
    });
    const ticket = await provider.getConnectionTicket({
      device: { id: "acp-test", tenantId: "local", instanceId: "acp-test", name: "test", runtimeStatus: "RUNNING", occupancyStatus: "IDLE" },
      endUserId: "local-user",
    });

    expect(ticket.ticket).toBe("test-ticket");
    expect(callApi.mock.calls[0][1]).toMatchObject({ query: { "InstanceIds.1": "acp-test" } });
    expect(Object.keys((callApi.mock.calls[0][1] as { query: Record<string, string> }).query)).toEqual(["InstanceIds.1"]);
  });
});
