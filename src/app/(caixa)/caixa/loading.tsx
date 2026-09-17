export default function CaixaLoading() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-48 animate-pulse rounded-viva-md bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-viva-lg bg-surface-2" />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-viva-lg bg-surface-2" />
    </div>
  );
}
