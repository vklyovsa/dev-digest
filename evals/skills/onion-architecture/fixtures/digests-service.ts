export interface Digest {
  id: string;
  title: string;
  publishedAt: string | null;
}

export interface DigestsRepositoryPort {
  markPublished(id: string, at: string): Promise<Digest>;
}

export class DigestsService {
  constructor(private readonly digests: DigestsRepositoryPort) {}

  async publish(digestId: string, at: string): Promise<Digest> {
    return this.digests.markPublished(digestId, at);
  }
}
