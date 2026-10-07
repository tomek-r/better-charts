/** Owns subscriptions as they resolve, including partial failures and unmounts. */
export class SubscriptionScope {
  private disposed = false;
  private cleanups: Array<() => void> = [];

  add(cleanup: () => void): void {
    if (this.disposed) {
      cleanup();
    } else {
      this.cleanups.push(cleanup);
    }
  }

  async register(registrations: Array<Promise<() => void>>): Promise<void> {
    try {
      await Promise.all(registrations.map((registration) => registration.then((cleanup) => this.add(cleanup))));
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0)) {
      cleanup();
    }
  }
}
