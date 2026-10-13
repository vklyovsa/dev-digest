export interface Reminder {
  id: string;
  pullId: string;
  note: string;
}

export interface RemindersRepositoryPort {
  findById(id: string): Promise<Reminder | null>;
  markDone(id: string): Promise<void>;
}

export class RemindersService {
  constructor(private readonly reminders: RemindersRepositoryPort) {}

  async complete(id: string): Promise<Reminder> {
    const reminder = await this.reminders.findById(id);
    if (!reminder) {
      throw new Error(`Reminder ${id} not found`);
    }
    await this.reminders.markDone(id);
    return reminder;
  }
}
