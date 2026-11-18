type ScheduledJob = { state: string; scheduled_at: string; next_attempt_at: string | null };

export function dashboardSchedule<T extends ScheduledJob>(jobs: T[], now = Date.now()) {
  const pending = jobs.filter((job) => ["SCHEDULED", "QUEUED", "PROCESSING", "BLOCKED_APPROVAL"].includes(job.state));
  const dueAt = (job: T) => Date.parse(job.next_attempt_at || job.scheduled_at);
  return {
    upcoming: pending.filter((job) => dueAt(job) >= now).sort((a, b) => dueAt(a) - dueAt(b)),
    overdue: pending.filter((job) => dueAt(job) < now),
  };
}
