export type PromptDirection = { id: string; prompt: string };

export function recoverImagePrompt(currentPrompt: string | undefined, directions: PromptDirection[], selectedDirectionId: string) {
  const direction = directions.find((item) => item.id === selectedDirectionId) ?? directions[0];
  return {
    directionId: direction?.id || "",
    prompt: currentPrompt?.trim() ? currentPrompt : direction?.prompt || "",
  };
}
