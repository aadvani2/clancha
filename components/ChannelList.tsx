"use client";

import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { setSelectedChannel } from "@/store/channelSlice";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { Skeleton } from "@/components/ui/skeleton";

export function ChannelList() {
  const dispatch = useAppDispatch();
  const { channels, selectedChannelId, loading } = useAppSelector((state) => state.channel);

  if (loading && channels.length === 0) {
      return (
          <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                  <div key={i} className="p-4 rounded-lg border bg-card border-border">
                      <div className="flex justify-between items-start">
                          <div className="space-y-2">
                              <Skeleton className="h-4 w-32" />
                              <Skeleton className="h-3 w-24" />
                          </div>
                          <Skeleton className="h-5 w-16" />
                      </div>
                  </div>
              ))}
          </div>
      );
  }

  if (channels.length === 0) {
      return (
          <div className="text-center py-8 text-muted-foreground">
              No channels yet. Create one to get started.
          </div>
      );
  }

  return (
    <div className="space-y-4">
        {channels.map((channel) => (
            <div 
                key={channel.id}
                className={cn(
                    "p-4 rounded-lg border cursor-pointer transition-colors hover:bg-muted/50",
                    selectedChannelId === channel.id ? "bg-muted border-primary" : "bg-card border-border"
                )}
                onClick={() => dispatch(setSelectedChannel(channel.id))}
            >
                <div className="flex justify-between items-start">
                    <div>
                        <h4 className="font-semibold text-foreground">{channel.name}</h4>
                        <p className="text-sm text-muted-foreground">{channel.assignedPhoneNumber}</p>
                    </div>
                    <Badge variant={channel.status === 'active' ? 'default' : 'secondary'}>
                        {channel.status}
                    </Badge>
                </div>
            </div>
        ))}
    </div>
  );
}
