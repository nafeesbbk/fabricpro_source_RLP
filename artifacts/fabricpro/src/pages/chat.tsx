import { useState } from "react";
import { useLocation } from "wouter";
import {
  useGetChatConversations,
  useSearchChatUsers,
  useSendConnectionRequest,
  useGetConnections,
  useDeleteConversation,
  getGetChatConversationsQueryKey,
  getGetConnectionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { MessageCircle, Search, X, UserPlus, Check, Clock, Trash2, CheckSquare, Square, Share2, Users } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { UserAvatar } from "@/components/user-avatar";

const APP_INVITE_TEXT = `FabricPro — fabric industry ka digital register! Download karo: https://fabric-flow-management--adeenadupatta.replit.app`;

export default function Chat() {
  const [, setLocation] = useLocation();
  const [searchQ, setSearchQ] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const { data: conversations, isLoading } = useGetChatConversations({
    query: {
      queryKey: getGetChatConversationsQueryKey(),
      refetchInterval: 5000,
      staleTime: 4000,
    },
  });

  const { data: searchResults, isLoading: isSearchLoading } = useSearchChatUsers(
    { q: searchQ },
    {
      query: {
        enabled: searchQ.trim().length >= 2,
        staleTime: 0,
      },
    }
  );

  const { data: connections = [] } = useGetConnections();
  const sendRequest = useSendConnectionRequest();
  const deleteConv = useDeleteConversation();
  const [requesting, setRequesting] = useState<Set<number>>(new Set());

  const acceptedConns = (connections as any[]).filter((c: any) => c.status === "accepted");
  const acceptedUserIds = new Set<number>(
    acceptedConns.map((c: any) => c.connectedUser?.id).filter(Boolean)
  );
  const pendingUserIds = new Set<number>(
    (connections as any[])
      .filter((c: any) => c.status === "pending")
      .map((c: any) => c.connectedUser?.id)
      .filter(Boolean)
  );

  const handleAddContact = (userId: number, userCode: string) => {
    setRequesting(prev => new Set(prev).add(userId));
    sendRequest.mutate(
      { data: { userCode, roleLabel: "karigar" } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetConnectionsQueryKey() });
          toast({ title: "Request bhej di!", description: "Accept hone par contacts mein aayega" });
        },
        onError: (e: any) => {
          setRequesting(prev => { const s = new Set(prev); s.delete(userId); return s; });
          toast({ title: e?.message ?? "Request nahi gayi", variant: "destructive" });
        },
      }
    );
  };

  const handleInvite = () => {
    if (navigator.share) {
      navigator.share({ text: APP_INVITE_TEXT }).catch(() => {});
    } else {
      navigator.clipboard.writeText(APP_INVITE_TEXT);
      toast({ title: "Link copy ho gaya!", description: "Kisi bhi app se paste karke bhejo" });
    }
  };

  function toggleSelect(userId: number) {
    setSelected(prev => {
      const s = new Set(prev);
      if (s.has(userId)) s.delete(userId);
      else s.add(userId);
      return s;
    });
  }

  function selectAll() {
    const convList = (conversations as any[]) ?? [];
    if (selected.size === convList.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(convList.map((c: any) => c.userId)));
    }
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      await Promise.all(
        Array.from(selected).map((uid) => deleteConv.mutateAsync({ userId: uid }))
      );
      qc.invalidateQueries({ queryKey: getGetChatConversationsQueryKey() });
      toast({ title: `${selected.size} conversation${selected.size > 1 ? "s" : ""} delete ho gaya` });
      setSelected(new Set());
      setEditMode(false);
    } catch {
      toast({ title: "Delete fail hua", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  const formatLastMsg = (content: string, type: string) => {
    if (type === "voice") return "🎤 Voice note";
    if (type === "image") return "📷 Photo";
    return content.length > 40 ? content.slice(0, 40) + "..." : content;
  };

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      const diff = Date.now() - d.getTime();
      if (diff < 60 * 60 * 1000) return formatDistanceToNow(d, { addSuffix: true });
      if (diff < 24 * 60 * 60 * 1000) return format(d, "hh:mm a");
      return format(d, "dd MMM");
    } catch {
      return "";
    }
  };

  const convList = (conversations as any[]) ?? [];
  const allSelected = convList.length > 0 && selected.size === convList.length;

  // Contacts not yet in conversations
  const convUserIds = new Set(convList.map((c: any) => c.userId));
  const contactsNotInConvs = acceptedConns.filter((c: any) => !convUserIds.has(c.connectedUser?.id));

  return (
    <Layout>
      <div className="pb-24">
        <header className="bg-primary text-primary-foreground px-6 pt-10 pb-4 rounded-b-3xl shadow-md">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <MessageCircle className="h-7 w-7" />
              <div>
                <h1 className="text-2xl font-bold">Chat</h1>
                <p className="text-primary-foreground/70 text-sm">Text, voice aur photos</p>
              </div>
            </div>
            {!searchQ && convList.length > 0 && (
              editMode ? (
                <button
                  onClick={() => { setEditMode(false); setSelected(new Set()); }}
                  className="text-sm font-semibold text-white/80 hover:text-white bg-white/10 px-3 py-1.5 rounded-full"
                >
                  Ruk Jao
                </button>
              ) : (
                <button
                  onClick={() => setEditMode(true)}
                  className="text-sm font-semibold text-white/80 hover:text-white bg-white/10 px-3 py-1.5 rounded-full flex items-center gap-1.5"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              )
            )}
          </div>

          {!editMode && (
            <div className="mt-4 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary-foreground/50" />
              <Input
                placeholder="Naam ya mobile se dhundo..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                className="h-11 pl-10 pr-10 bg-white/20 border-white/30 text-white placeholder:text-white/50 rounded-xl"
              />
              {searchQ && (
                <button onClick={() => setSearchQ("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="h-4 w-4 text-white/70" />
                </button>
              )}
            </div>
          )}

          {editMode && convList.length > 0 && (
            <div className="mt-3 flex items-center justify-between">
              <button onClick={selectAll} className="flex items-center gap-1.5 text-sm text-white/80">
                {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {allSelected ? "Sab hatao" : "Sab chuno"}
              </button>
              <span className="text-sm text-white/60">{selected.size} selected</span>
            </div>
          )}
        </header>

        <div className="px-4 pt-4 space-y-2">
          {/* ── Search Results ── */}
          {searchQ.trim().length >= 2 && (
            <div>
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide px-1 mb-2">
                Search Results
              </p>
              {isSearchLoading ? (
                <Skeleton className="h-16 w-full rounded-2xl" />
              ) : !searchResults?.length ? (
                <div className="text-center py-8 space-y-3">
                  <p className="text-muted-foreground text-sm">
                    "<span className="font-semibold">{searchQ}</span>" naam ka koi member nahi mila
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-left">
                    <p className="text-sm font-semibold text-amber-800 mb-1">FabricPro member nahi hai?</p>
                    <p className="text-xs text-amber-700 mb-3">Unhe invite karo — free mein join kar sakte hain</p>
                    <Button
                      size="sm"
                      onClick={handleInvite}
                      className="w-full h-10 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl gap-2"
                    >
                      <Share2 className="h-4 w-4" />
                      FabricPro Invite Karo
                    </Button>
                  </div>
                </div>
              ) : (
                (searchResults as any[]).map((u) => (
                  <div
                    key={u.id}
                    className="w-full flex items-center gap-3 p-4 bg-card border border-border rounded-2xl shadow-sm mb-2"
                  >
                    <button className="flex-1 flex items-center gap-3 text-left" onClick={() => setLocation(`/chat/${u.id}`)}>
                      <UserAvatar userId={u.id} name={u.name} code={u.code} avatarUrl={u.avatarUrl} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold truncate">{u.name || u.code || "—"}</p>
                        <p className="text-sm text-muted-foreground font-mono">{u.mobile}</p>
                      </div>
                    </button>
                    {u.connectionStatus === "accepted" ? (
                      <span className="flex items-center gap-1 text-xs text-green-600 font-semibold bg-green-50 px-2 py-1 rounded-full border border-green-200">
                        <Check className="h-3 w-3" /> Contact
                      </span>
                    ) : u.connectionStatus === "pending" || requesting.has(u.id) ? (
                      <span className="flex items-center gap-1 text-xs text-amber-600 font-semibold bg-amber-50 px-2 py-1 rounded-full">
                        <Clock className="h-3 w-3" /> Pending
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs rounded-full gap-1 border-primary text-primary"
                        onClick={() => handleAddContact(u.id, u.code)}
                        disabled={sendRequest.isPending}
                      >
                        <UserPlus className="h-3 w-3" /> Add
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── No-search mode: Contacts + Conversations ── */}
          {!searchQ && (
            <>
              {/* Contacts not yet in conversations */}
              {!editMode && contactsNotInConvs.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide px-1 mb-2 flex items-center gap-1.5">
                    <Users className="h-3 w-3" /> Contacts
                  </p>
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide" style={{ touchAction: "pan-x" }}>
                    {contactsNotInConvs.map((conn: any) => {
                      const u = conn.connectedUser;
                      return (
                        <button
                          key={u?.id}
                          onClick={() => setLocation(`/chat/${u?.id}`)}
                          className="flex flex-col items-center gap-1.5 min-w-[64px]"
                        >
                          <UserAvatar userId={u?.id} name={u?.name} code={u?.code} avatarUrl={u?.avatarUrl} size="md" />
                          <span className="text-xs font-semibold text-center w-16 truncate">{u?.name || u?.code}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Conversations */}
              {!editMode && (
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide px-1 mb-2">
                  Recent Conversations
                </p>
              )}
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)
              ) : !convList.length ? (
                <div className="text-center py-12">
                  <MessageCircle className="h-14 w-14 mx-auto text-muted-foreground/20 mb-4" />
                  <p className="text-muted-foreground font-medium">Koi conversation nahi</p>
                  <p className="text-muted-foreground text-sm mt-1">
                    Upar search karo aur pehla message bhejo
                  </p>
                  <button
                    onClick={handleInvite}
                    className="mt-4 flex items-center gap-2 mx-auto text-primary text-sm font-semibold"
                  >
                    <Share2 className="h-4 w-4" />
                    Kisi ko Invite Karo
                  </button>
                </div>
              ) : (
                convList.map((conv: any) => {
                  const isConnected = acceptedUserIds.has(conv.userId);
                  const isPending = pendingUserIds.has(conv.userId) || requesting.has(conv.userId);
                  const isChecked = selected.has(conv.userId);
                  return (
                    <div
                      key={conv.userId}
                      className={`w-full flex items-center gap-3 p-4 bg-card border rounded-2xl shadow-sm mb-1 transition-all ${
                        editMode && isChecked ? "border-primary bg-primary/5" : "border-border"
                      }`}
                    >
                      {editMode && (
                        <button onClick={() => toggleSelect(conv.userId)} className="shrink-0">
                          {isChecked
                            ? <CheckSquare className="h-5 w-5 text-primary" />
                            : <Square className="h-5 w-5 text-muted-foreground" />}
                        </button>
                      )}
                      <button
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        onClick={() => editMode ? toggleSelect(conv.userId) : setLocation(`/chat/${conv.userId}`)}
                      >
                        <div className="relative shrink-0">
                          <UserAvatar userId={conv.userId} name={conv.user.name} code={conv.user.code} avatarUrl={(conv.user as any).avatarUrl} size="md" />
                          {!editMode && (conv.unreadCount ?? 0) > 0 && (
                            <span className="absolute -top-1 -right-1 h-5 min-w-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                              {conv.unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="font-bold truncate">{conv.user.name || conv.user.code || "User"}</p>
                            {!editMode && conv.lastMessage && (
                              <p className="text-xs text-muted-foreground shrink-0 ml-2">
                                {formatTime(conv.lastMessage.createdAt)}
                              </p>
                            )}
                          </div>
                          {conv.lastMessage ? (
                            <p className={`text-sm truncate mt-0.5 ${conv.unreadCount && !editMode ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                              {conv.lastMessage.fromUserId !== conv.userId ? "Aapne: " : ""}
                              {formatLastMsg(conv.lastMessage.content, conv.lastMessage.type)}
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">No messages yet</p>
                          )}
                        </div>
                      </button>
                      {!editMode && !isConnected && (
                        isPending ? (
                          <span className="flex items-center gap-1 text-xs text-amber-600 font-semibold bg-amber-50 px-2 py-1 rounded-full shrink-0">
                            <Clock className="h-3 w-3" /> Pending
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs rounded-full gap-1 border-primary text-primary shrink-0"
                            onClick={() => handleAddContact(conv.userId, conv.user.code)}
                            disabled={sendRequest.isPending}
                          >
                            <UserPlus className="h-3 w-3" /> Add
                          </Button>
                        )
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>

      {/* Delete bar */}
      {editMode && selected.size > 0 && (
        <div className="fixed bottom-20 left-0 right-0 px-4 z-40">
          <div className="max-w-md mx-auto">
            <Button
              onClick={handleDeleteSelected}
              disabled={deleting}
              variant="destructive"
              className="w-full h-12 rounded-2xl text-base font-bold flex items-center gap-2 shadow-xl"
            >
              <Trash2 className="h-5 w-5" />
              {deleting ? "Delete ho raha hai..." : `${selected.size} Conversation${selected.size > 1 ? "s" : ""} Delete Karo`}
            </Button>
          </div>
        </div>
      )}
    </Layout>
  );
}
