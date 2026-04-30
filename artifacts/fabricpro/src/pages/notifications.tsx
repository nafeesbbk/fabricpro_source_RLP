import { useGetNotifications, getGetNotificationsQueryKey, useMarkNotificationRead, useMarkAllNotificationsRead } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Check, Link2, Package, IndianRupee } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

export default function Notifications() {
  const queryClient = useQueryClient();

  const { data: notifications, isLoading } = useGetNotifications({
    query: { queryKey: getGetNotificationsQueryKey(), refetchInterval: 8_000 }
  });

  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const handleMarkAllRead = () => {
    markAllRead.mutate({}, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
      }
    });
  };

  const handleMarkRead = (id: number) => {
    markRead.mutate({ params: { id } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
      }
    });
  };

  const getIcon = (type: string) => {
    if (type === "connection_request") return <Link2 className="h-5 w-5 text-primary" />;
    if (type === "payment_update") return <IndianRupee className="h-5 w-5 text-green-600" />;
    return <Package className="h-5 w-5 text-orange-500" />;
  };

  const unreadCount = (notifications ?? []).filter((n) => !n.isRead).length;

  return (
    <Layout>
      <div className="pb-24">
        <header className="bg-primary text-primary-foreground px-6 pt-10 pb-6 rounded-b-3xl shadow-md">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold">Notifications</h1>
              <p className="text-primary-foreground/70 text-sm mt-1">
                {unreadCount > 0 ? `${unreadCount} naye notifications` : "Sab padh liye"}
              </p>
            </div>
            {unreadCount > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleMarkAllRead}
                disabled={markAllRead.isPending}
                className="text-xs"
              >
                <Check className="h-3 w-3 mr-1" />
                Sab Padha
              </Button>
            )}
          </div>
        </header>

        <div className="px-4 pt-4 space-y-3">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)
          ) : !notifications || notifications.length === 0 ? (
            <div className="text-center py-16">
              <Bell className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground font-medium">Koi notification nahi</p>
            </div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                className={`relative rounded-2xl p-4 shadow-sm border cursor-pointer transition-all ${
                  notif.isRead
                    ? "bg-card border-border"
                    : "bg-primary/5 border-primary/20 shadow-md"
                }`}
                onClick={() => !notif.isRead && handleMarkRead(notif.id)}
              >
                {!notif.isRead && (
                  <div className="absolute top-4 right-4 w-2 h-2 bg-primary rounded-full" />
                )}
                <div className="flex gap-3">
                  <div className={`p-2 rounded-full flex-shrink-0 ${notif.isRead ? "bg-muted" : "bg-primary/10"}`}>
                    {getIcon(notif.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold ${notif.isRead ? "text-muted-foreground" : "text-foreground"}`}>
                      {notif.title}
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                    {notif.createdAt && (
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {format(new Date(notif.createdAt), "dd MMM, hh:mm a")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
