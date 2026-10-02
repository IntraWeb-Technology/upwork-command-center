const formatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

/** Server and browser time zones can differ, so the formatted text may legitimately change on hydration. */
export function DateTime({ value, className }: { value: string; className?: string }) {
  return (
    <time dateTime={value} className={className} suppressHydrationWarning>
      {formatter.format(new Date(value))}
    </time>
  );
}
