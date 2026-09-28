export type AppModule = "overview" | "knowledge" | "pipeline" | "phone" | "private";
export type PhoneTab = "control" | "publish";
export type WorkflowStep = 1 | 2 | 3 | 4 | 5;

const modules = new Set<AppModule>(["overview", "knowledge", "pipeline", "phone", "private"]);
const phoneTabs = new Set<PhoneTab>(["control", "publish"]);

export function readNavigationState(search: string) {
  const params = new URLSearchParams(search);
  const moduleValue = params.get("module") as AppModule | null;
  const phoneTabValue = params.get("phoneTab") as PhoneTab | null;
  const stepValue = Number(params.get("step"));
  return {
    module: moduleValue && modules.has(moduleValue) ? moduleValue : "knowledge" as AppModule,
    step: Number.isInteger(stepValue) && stepValue >= 1 && stepValue <= 5 ? stepValue as WorkflowStep : 1,
    phoneTab: phoneTabValue && phoneTabs.has(phoneTabValue) ? phoneTabValue : "control" as PhoneTab,
  };
}

export function updateNavigationState(
  patch: Partial<{ module: AppModule; step: WorkflowStep; phoneTab: PhoneTab }>,
  mode: "push" | "replace" = "push",
) {
  const url = new URL(window.location.href);
  if (patch.module) url.searchParams.set("module", patch.module);
  if (patch.step) url.searchParams.set("step", String(patch.step));
  if (patch.phoneTab) url.searchParams.set("phoneTab", patch.phoneTab);
  window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
}
