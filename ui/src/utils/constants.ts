export const CHANNEL_TYPES: Record<number, string> = {
  0: 'OpenAI Chat',
  1: 'OpenAI Response',
  2: 'Anthropic',
  3: 'Gemini',
  4: 'Volcengine',
  5: 'OpenAI Embedding',
};

export const GROUP_MODES: Record<number, string> = {
  1: 'Round Robin',
  2: 'Random',
  3: 'Failover',
  4: 'Weighted',
};

export const AUTO_GROUP_TYPES: Record<number, string> = {
  0: 'None',
  1: 'Fuzzy',
  2: 'Exact',
  3: 'Regex',
};

export const CHANNEL_TYPE_OPTIONS = Object.entries(CHANNEL_TYPES).map(([v, l]) => ({
  value: Number(v),
  label: l,
}));

export const GROUP_MODE_OPTIONS = Object.entries(GROUP_MODES).map(([v, l]) => ({
  value: Number(v),
  label: l,
}));

export const AUTO_GROUP_OPTIONS = Object.entries(AUTO_GROUP_TYPES).map(([v, l]) => ({
  value: Number(v),
  label: l,
}));
