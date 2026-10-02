export class QualificationQueue {
  private waiting: string[] = [];
  private active = 0;
  private readonly seen = new Set<string>();

  constructor(
    private readonly limit: number,
    private readonly run: (prospectId: string) => Promise<void>,
  ) {}

  get activeCount() {
    return this.active;
  }

  get pendingCount() {
    return this.waiting.length;
  }

  enqueue(prospectId: string) {
    if (!prospectId || this.seen.has(prospectId)) return false;
    this.seen.add(prospectId);
    this.waiting.push(prospectId);
    this.pump();
    return true;
  }

  private pump() {
    const limit = Math.max(1, this.limit);
    while (this.active < limit && this.waiting.length > 0) {
      const prospectId = this.waiting.shift();
      if (!prospectId) return;
      this.active += 1;
      void this.run(prospectId).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  async drain() {
    while (this.active > 0 || this.waiting.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}
