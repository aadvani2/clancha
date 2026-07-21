"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppSelector } from "@/hooks/redux";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminPage() {
  const router = useRouter();
  const { currentUser } = useAppSelector((state) => state.user);
  const [stats, setStats] = useState({
    userCount: 0,
    channelCount: 0,
    messageCount: 0,
  });

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin" && currentUser.role !== "super_admin") {
      router.push("/dashboard");
      return;
    }
    if (currentUser?.role === "admin" || currentUser?.role === "super_admin") {
      fetch("/api/admin/stats", { credentials: "include" })
        .then((r) => r.json())
        .then((d) => {
          if (d.userCount !== undefined) setStats(d);
        })
        .catch(() => {});
    }
  }, [currentUser, router]);

  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'super_admin')) {
      return <div>Access Denied</div>;
  }

  return (
    <div className="container mx-auto p-8">
        <h1 className="text-3xl font-bold mb-8">Admin Dashboard</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card>
                <CardHeader>
                    <CardTitle>Total Users</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-4xl font-bold">{stats.userCount}</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Active Channels</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-4xl font-bold">{stats.channelCount}</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Total Messages</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-4xl font-bold">{stats.messageCount}</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>System Health</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-green-600 font-bold">Operational</p>
                </CardContent>
            </Card>
        </div>

        <div className="mt-8">
            <h2 className="text-xl font-semibold mb-4">Management Actions</h2>
            <div className="flex gap-4">
                <Button variant="outline">Manage Users</Button>
                <Button variant="outline">Manage Channels</Button>
                <Button variant="outline">Billing Overview</Button>
            </div>
        </div>
    </div>
  );
}
