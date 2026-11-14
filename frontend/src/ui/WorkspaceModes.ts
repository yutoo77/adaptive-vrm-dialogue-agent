export type WorkspaceMode = "dialogue" | "experience";

export class WorkspaceModes {
  private readonly events = new AbortController();
  private current: WorkspaceMode = "dialogue";

  public constructor(
    private readonly root: HTMLElement,
    private readonly experienceAvatarSlot: HTMLElement,
    private readonly onChange: (mode: WorkspaceMode) => void,
  ) {
    const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-workspace-mode]"));
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => this.select(tab.dataset["workspaceMode"] as WorkspaceMode), { signal: this.events.signal });
      tab.addEventListener("keydown", (event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
          : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next === null) return;
        const destination = tabs[next];
        if (!destination) return;
        event.preventDefault();
        this.select(destination.dataset["workspaceMode"] as WorkspaceMode);
        destination.focus();
      }, { signal: this.events.signal });
    });
    root.dataset["workspaceMode"] = this.current;
  }

  public select(mode: WorkspaceMode): void {
    if (mode === this.current || (mode !== "dialogue" && mode !== "experience")) return;
    this.current = mode;
    // Stop the previous mode before moving its still-live canvas or showing another panel.
    this.onChange(mode);
    const dialogue = this.node("#dialogue-workspace");
    const experience = this.node("#experience-workspace");
    const avatar = this.node(".viewer-card");
    if (mode === "experience") this.experienceAvatarSlot.append(avatar);
    else dialogue.prepend(avatar);
    dialogue.hidden = mode !== "dialogue";
    experience.hidden = mode !== "experience";
    this.root.dataset["workspaceMode"] = mode;
    this.root.querySelectorAll<HTMLButtonElement>("[data-workspace-mode]").forEach((tab) => {
      const selected = tab.dataset["workspaceMode"] === mode;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
  }

  public dispose(): void { this.events.abort(); }

  private node(selector: string): HTMLElement {
    const node = this.root.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`Missing workspace node: ${selector}`);
    return node;
  }
}
