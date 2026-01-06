export class FifoQueue<T> {
  private items: T[] = [];
  private head = 0;

  get length(): number {
    return this.items.length - this.head;
  }

  push(item: T): void {
    this.items.push(item);
  }

  shift(): T | undefined {
    if (this.head >= this.items.length) return undefined;

    const item = this.items[this.head] as T;
    this.head += 1;

    if (this.head > 64 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }

    return item;
  }

  clear(): void {
    this.items.length = 0;
    this.head = 0;
  }
}
