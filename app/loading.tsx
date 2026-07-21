import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="h-[100dvh] min-h-[100svh] overflow-y-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-6 sm:container sm:mx-auto sm:py-8">
      <div className="flex flex-col gap-3 mb-8 min-[380px]:flex-row min-[380px]:items-center min-[380px]:justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-6">
          <Skeleton className="h-[300px] w-full rounded-xl" />
          <Skeleton className="h-[200px] w-full rounded-xl" />
        </div>
        <div className="md:col-span-2 space-y-4">
             <Skeleton className="h-[600px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
