export interface QueuePost {
  id?: unknown;
  status?: unknown;
  variants?: Array<Record<string, any>>;
}

interface QueueApi {
  <T>(path: string, init?: Omit<RequestInit, 'body'> & { body?: BodyInit | null | undefined }): Promise<T>;
}

export interface QueueProgress {
  completedPosts: number;
  totalPosts: number;
  completedVisuals: number;
  generatedVisuals: number;
  currentLabel: string;
}

const textNeeded = (post: QueuePost) => {
  const variants = Array.isArray(post.variants) ? post.variants : [];
  return variants.length === 0 || ['idea', 'draft', 'needs_review', 'generating'].includes(String(post.status ?? '').toLowerCase());
};

const activeVariants = (variants: Array<Record<string, any>>) => variants.filter((variant) => variant.platform_decision !== 'skip');

export async function generateContentIncrementally(input: {
  api: QueueApi;
  tenantId: string;
  posts: QueuePost[];
  imagesReady: boolean;
  onProgress?: (progress: QueueProgress) => void;
}) {
  const posts = input.posts.filter((post) => Boolean(String(post.id ?? '').trim()) && !['published', 'publishing', 'rejected'].includes(String(post.status ?? '').toLowerCase()));
  let completedPosts = 0;
  let completedVisuals = 0;
  let generatedVisuals = 0;

  for (const post of posts) {
    const postId = String(post.id ?? '').trim();
    if (!postId) continue;
    let variants = Array.isArray(post.variants) ? post.variants : [];
    if (textNeeded(post)) {
      input.onProgress?.({ completedPosts, totalPosts: posts.length, completedVisuals, generatedVisuals, currentLabel: 'Generazione testo…' });
      const result = await input.api<{ variants?: Array<Record<string, any>> }>(`/tenants/${input.tenantId}/posts/${postId}/generate`, { method: 'POST' });
      variants = Array.isArray(result.variants) ? result.variants : variants;
    }
    completedPosts += 1;

    if (input.imagesReady) {
      for (const variant of activeVariants(variants)) {
        const variantId = String(variant.id ?? '');
        if (!variantId) continue;
        input.onProgress?.({ completedPosts, totalPosts: posts.length, completedVisuals, generatedVisuals, currentLabel: 'Verifica visuale…' });
        const existing = await input.api<Record<string, unknown> | null>(`/tenants/${input.tenantId}/variants/${variantId}/visual`).catch(() => null);
        if (!existing) {
          input.onProgress?.({ completedPosts, totalPosts: posts.length, completedVisuals, generatedVisuals, currentLabel: 'Generazione OpenAI Immagini 2…' });
          await input.api(`/tenants/${input.tenantId}/variants/${variantId}/visual`, { method: 'POST' });
          generatedVisuals += 1;
        }
        completedVisuals += 1;
      }
    }
  }

  return { completedPosts, completedVisuals, generatedVisuals };
}
