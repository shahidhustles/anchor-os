export function StorageBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <p
      role="alert"
      data-slot="storage-unavailable"
      className="rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-xs font-medium text-warn"
    >
      Browser storage is unavailable in this profile, so changes to the demo will not survive a
      reload.
    </p>
  );
}
