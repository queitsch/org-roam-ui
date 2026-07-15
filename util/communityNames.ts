// Names graph communities using an OpenAI-compatible chat endpoint (e.g. Ollama).
// Names are cached in localStorage keyed by a signature of the community's most
// connected note titles, so unchanged communities are not re-queried.

export type CommunityMembers = { [community: number]: string[] }
export type CommunityNames = { [community: number]: string }

const CACHE_KEY = 'communityNamesCache-v2'
const MAX_TITLES_PER_PROMPT = 20
const CONCURRENCY = 2

const SYSTEM_PROMPT =
  'You label clusters of personal notes. ' +
  'Given a list of note titles from one cluster, respond with a short descriptive label ' +
  'of one to three words for the cluster. ' +
  'Respond in English, with only the label: no quotes, no punctuation, no explanation.'

// stable short signature for a community based on its representative titles
export const communitySignature = (titles: string[]) => {
  const text = titles.slice(0, MAX_TITLES_PER_PROMPT).join('\n')
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return `${titles.length}:${hash.toString(36)}`
}

const readCache = (): { [signature: string]: string } => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch (e) {
    return {}
  }
}

const writeCache = (signature: string, name: string) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), [signature]: name }))
  } catch (e) {
    // localStorage full or unavailable, names just won't persist
  }
}

const cleanName = (raw: string) => {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/[_-]/g, ' ')
    .replace(/["'`*.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 4)
    .join(' ')
    .substring(0, 40)
}

let pickedModel: { url: string; model: string } | null = null
const pickModel = async (url: string, configured: string): Promise<string> => {
  if (configured) {
    return configured
  }
  if (pickedModel?.url === url) {
    return pickedModel.model
  }
  const res = await fetch(`${url}/models`)
  if (!res.ok) {
    throw new Error(`Could not list models: ${res.status}`)
  }
  const { data } = await res.json()
  const models: string[] = (data ?? []).map((m: { id: string }) => m.id)
  const chatModels = models.filter((id) => !id.includes('embed'))
  const model = chatModels.find((id) => /instruct/i.test(id)) ?? chatModels[0]
  if (!model) {
    throw new Error('No chat model available on the endpoint')
  }
  pickedModel = { url, model }
  return model
}

const nameOneCommunity = async (url: string, model: string, titles: string[]): Promise<string> => {
  const shownTitles = titles.slice(0, MAX_TITLES_PER_PROMPT)
  const res = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Note titles:\n${shownTitles.map((t) => `- ${t}`).join('\n')}`,
        },
      ],
    }),
  })
  if (!res.ok) {
    throw new Error(`Chat completion failed: ${res.status}`)
  }
  const completion = await res.json()
  return cleanName(completion?.choices?.[0]?.message?.content ?? '')
}

/**
 * Resolve a name for every community in `members`. Cached names are delivered
 * synchronously via `onName`; the rest are fetched from the endpoint with
 * limited concurrency and delivered as they arrive. Returns a cancel function.
 */
export const nameCommunities = ({
  url,
  model,
  members,
  onName,
}: {
  url: string
  model: string
  members: CommunityMembers
  onName: (community: number, name: string) => void
}): (() => void) => {
  let cancelled = false
  const cache = readCache()

  const pending: { community: number; titles: string[]; signature: string }[] = []
  Object.entries(members).forEach(([communityKey, titles]) => {
    const community = Number(communityKey)
    const signature = communitySignature(titles)
    if (cache[signature]) {
      onName(community, cache[signature])
      return
    }
    pending.push({ community, titles, signature })
  })

  if (pending.length) {
    ;(async () => {
      const resolvedModel = await pickModel(url, model)
      const worker = async () => {
        while (pending.length && !cancelled) {
          const job = pending.shift()!
          try {
            const name = await nameOneCommunity(url, resolvedModel, job.titles)
            if (name) {
              writeCache(job.signature, name)
              if (!cancelled) {
                onName(job.community, name)
              }
            }
          } catch (e) {
            console.error(`Failed to name community ${job.community}:`, e)
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    })().catch((e) => console.error('Community naming failed:', e))
  }

  return () => {
    cancelled = true
  }
}
