type LogValue = string | number | boolean | null | readonly LogValue[];
type LogDetails = Record<string, LogValue>;

export function logEvent(event: string, details: LogDetails = {}): void {
  process.stdout.write(
    `${JSON.stringify({
      time: new Date().toISOString(),
      event,
      ...details,
    })}\n`,
  );
}
