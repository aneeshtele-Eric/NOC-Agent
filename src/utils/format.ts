export function formatSlaRemaining(slaDeadlineIso: string, status: string): {
  label: string;
  tier: 'breached' | 'imminent' | 'warning' | 'nominal' | 'resolved';
  minutesRemaining: number;
} {
  if (status === 'Resolved') {
    return { label: 'Resolved', tier: 'resolved', minutesRemaining: 0 };
  }
  const diffMs = new Date(slaDeadlineIso).getTime() - Date.now();
  const mins = Math.round(diffMs / 60_000);

  if (mins < 0) {
    const absMins = Math.abs(mins);
    const hrs = Math.floor(absMins / 60);
    const rem = absMins % 60;
    return {
      label: hrs > 0 ? `Breached -${hrs}h ${rem}m` : `Breached -${rem}m`,
      tier: 'breached',
      minutesRemaining: mins,
    };
  }
  if (mins <= 60) {
    return { label: `${mins}m left`, tier: 'imminent', minutesRemaining: mins };
  }
  if (mins <= 180) {
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return { label: `${hrs}h ${rem}m left`, tier: 'warning', minutesRemaining: mins };
  }
  const hrs = Math.floor(mins / 60);
  if (hrs >= 24) {
    const days = Math.floor(hrs / 24);
    return { label: `${days}d ${hrs % 24}h left`, tier: 'nominal', minutesRemaining: mins };
  }
  return { label: `${hrs}h ${mins % 60}m left`, tier: 'nominal', minutesRemaining: mins };
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    if (contentType.includes('application/json')) {
      const errBody = (await res.json()) as { error?: string };
      throw new Error(errBody.error || `Request failed (${res.status})`);
    }
    throw new Error(`Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}
