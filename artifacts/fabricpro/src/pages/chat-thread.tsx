import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetChatMessages,
  useSendMessage,
  useGetUserById,
  getGetChatMessagesQueryKey,
  getGetChatConversationsQueryKey,
} from "@workspace/api-client-react";
import { useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { UserAvatar } from "@/components/user-avatar";
import {
  ArrowLeft,
  Send,
  Mic,
  MicOff,
  Play,
  Pause,
  Square,
  Image as ImageIcon,
  X,
  Reply,
  MoreVertical,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";

type Msg = {
  id: number;
  fromUserId: number;
  toUserId: number;
  type: string;
  content: string;
  replyToId?: number | null;
  replyPreview?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  createdAt: string;
};

type ReplyState = { id: number; preview: string; type: "text" | "image" | "voice"; imageSrc?: string } | null;

// 3-state tick: single gray = sent, double gray = delivered, blue = read
function MessageTick({ deliveredAt, readAt }: { deliveredAt?: string | null; readAt?: string | null }) {
  if (readAt) {
    // Blue double tick — read
    return (
      <span className="inline-flex items-center shrink-0" title="Padh liya">
        <svg viewBox="0 0 16 15" className="h-3.5 w-3.5 fill-blue-400" xmlns="http://www.w3.org/2000/svg">
          <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.032l-.7-.7a.32.32 0 0 0-.484.032l-.478.601a.32.32 0 0 0 .032.484l1.38 1.1a.318.318 0 0 0 .484-.031l6.594-8.131a.366.366 0 0 0-.064-.51z"/>
          <path d="M11.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.666 9.88a.32.32 0 0 1-.484.032l-.7-.7a.32.32 0 0 0-.484.032l-.478.601a.32.32 0 0 0 .032.484l1.38 1.1a.318.318 0 0 0 .484-.031l6.594-8.131a.366.366 0 0 0-.064-.51z"/>
        </svg>
      </span>
    );
  }
  if (deliveredAt) {
    // Gray double tick — delivered
    return (
      <span className="inline-flex items-center shrink-0" title="Pahuncha">
        <svg viewBox="0 0 16 15" className="h-3.5 w-3.5 fill-primary-foreground/50" xmlns="http://www.w3.org/2000/svg">
          <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.032l-.7-.7a.32.32 0 0 0-.484.032l-.478.601a.32.32 0 0 0 .032.484l1.38 1.1a.318.318 0 0 0 .484-.031l6.594-8.131a.366.366 0 0 0-.064-.51z"/>
          <path d="M11.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.666 9.88a.32.32 0 0 1-.484.032l-.7-.7a.32.32 0 0 0-.484.032l-.478.601a.32.32 0 0 0 .032.484l1.38 1.1a.318.318 0 0 0 .484-.031l6.594-8.131a.366.366 0 0 0-.064-.51z"/>
        </svg>
      </span>
    );
  }
  // Gray single tick — sent (not yet delivered)
  return (
    <span className="inline-flex items-center shrink-0" title="Bheja">
      <svg viewBox="0 0 16 15" className="h-3.5 w-3.5 fill-primary-foreground/50" xmlns="http://www.w3.org/2000/svg">
        <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.032l-.7-.7a.32.32 0 0 0-.484.032l-.478.601a.32.32 0 0 0 .032.484l1.38 1.1a.318.318 0 0 0 .484-.031l6.594-8.131a.366.366 0 0 0-.064-.51z"/>
      </svg>
    </span>
  );
}

function VoicePlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoaded = () => setDuration(audio.duration || 0);
    const onTimeUpdate = () => {
      if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100);
    };
    const onEnded = () => { setPlaying(false); setProgress(0); };
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play(); setPlaying(true); }
  };

  const fmtDur = (s: number) => isNaN(s) || !isFinite(s) ? "0:00" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-2 min-w-[160px]">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button onClick={toggle} className="h-8 w-8 rounded-full bg-white/30 flex items-center justify-center shrink-0">
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
      </button>
      <div className="flex-1 space-y-1">
        <div className="h-1.5 bg-white/30 rounded-full overflow-hidden">
          <div className="h-full bg-white/80 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-[10px] opacity-70">{fmtDur(duration)}</p>
      </div>
      <Mic className="h-3.5 w-3.5 opacity-60 shrink-0" />
    </div>
  );
}

// Reply quote bubble shown inside a message
function ReplyBubble({ msg, origMsg, isMe }: { msg: Msg; origMsg?: Msg; isMe: boolean }) {
  const isImage = origMsg?.type === "image" || msg.replyPreview === "📷 Photo";
  const isVoice = origMsg?.type === "voice" || msg.replyPreview === "🎤 Voice note";

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-t-xl border-l-4 ${
        isMe
          ? "bg-white/20 border-white/70"
          : "bg-primary/10 border-primary"
      }`}
    >
      <Reply className={`h-3 w-3 shrink-0 ${isMe ? "text-white/70" : "text-primary"}`} />
      {isImage && origMsg?.content && !origMsg.content.startsWith("📷") ? (
        <img src={origMsg.content} alt="reply" className="h-9 w-9 rounded object-cover shrink-0 border border-white/30" />
      ) : isImage ? (
        <div className="h-9 w-9 rounded bg-white/20 flex items-center justify-center shrink-0">
          <ImageIcon className="h-4 w-4 opacity-60" />
        </div>
      ) : isVoice ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <Mic className="h-3.5 w-3.5 opacity-70" />
        </div>
      ) : null}
      <p className={`text-[11px] truncate flex-1 ${isMe ? "text-white/80" : "text-muted-foreground"}`}>
        {msg.replyPreview}
      </p>
    </div>
  );
}

export default function ChatThread() {
  const params = useParams<{ userId: string }>();
  const otherId = parseInt(params.userId, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [replyTo, setReplyTo] = useState<ReplyState>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const { data: me } = useGetMe();
  const { data: otherUser } = useGetUserById(otherId, {
    query: { enabled: !isNaN(otherId), staleTime: 60000 },
  });
  const { data: messages, isLoading } = useGetChatMessages(otherId, {
    query: {
      queryKey: getGetChatMessagesQueryKey(otherId),
      enabled: !isNaN(otherId),
      refetchInterval: 5000,
      staleTime: 4000,
    },
  });

  const sendMutation = useSendMessage();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetChatMessagesQueryKey(otherId) });
    queryClient.invalidateQueries({ queryKey: getGetChatConversationsQueryKey() });
  };

  const msgById = useMemo(() => {
    const map = new Map<number, Msg>();
    (messages as Msg[] ?? []).forEach((m) => map.set(m.id, m));
    return map;
  }, [messages]);

  const msgPreviewText = (m: Msg) => {
    if (m.type === "voice") return "🎤 Voice note";
    if (m.type === "image") return "📷 Photo";
    return m.content.length > 50 ? m.content.slice(0, 50) + "..." : m.content;
  };

  const handleReply = (msg: Msg) => {
    setReplyTo({
      id: msg.id,
      preview: msgPreviewText(msg),
      type: msg.type as "text" | "image" | "voice",
      imageSrc: msg.type === "image" ? msg.content : undefined,
    });
  };

  const handleClearChat = async () => {
    setClearing(true);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(`/api/chat/${otherId}/clear`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: getGetChatMessagesQueryKey(otherId) });
      queryClient.invalidateQueries({ queryKey: getGetChatConversationsQueryKey() });
      toast({ title: "Chat clear ho gayi ✅" });
    } catch {
      toast({ title: "Clear nahi ho payi", variant: "destructive" });
    } finally {
      setClearing(false);
      setClearConfirm(false);
      setShowMenu(false);
    }
  };

  const sendText = () => {
    if (!text.trim()) return;
    const payload: any = { type: "text", content: text.trim() };
    if (replyTo) { payload.replyToId = replyTo.id; payload.replyPreview = replyTo.preview; }
    sendMutation.mutate(
      { userId: otherId, data: payload },
      {
        onSuccess: () => { setText(""); setReplyTo(null); invalidate(); },
        onError: (e: any) => toast({ title: e?.message ?? "Message nahi gaya", variant: "destructive" }),
      }
    );
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "5MB se chhoti photo choose karo", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const b64 = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX = 800;
        const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const resized = canvas.toDataURL("image/jpeg", 0.75);
        const payload: any = { type: "image", content: resized };
        if (replyTo) { payload.replyToId = replyTo.id; payload.replyPreview = replyTo.preview; }
        sendMutation.mutate(
          { userId: otherId, data: payload },
          {
            onSuccess: () => { setReplyTo(null); invalidate(); },
            onError: (e: any) => toast({ title: e?.message ?? "Photo nahi gayi", variant: "destructive" }),
          }
        );
      };
      img.src = b64;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 100) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = reader.result as string;
          const payload: any = { type: "voice", content: b64 };
          if (replyTo) { payload.replyToId = replyTo.id; payload.replyPreview = replyTo.preview; }
          sendMutation.mutate(
            { userId: otherId, data: payload },
            {
              onSuccess: () => { setReplyTo(null); invalidate(); },
              onError: (e: any) => toast({ title: e?.message ?? "Voice note nahi gaya", variant: "destructive" }),
            }
          );
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 29) { stopRecording(); return 30; }
          return s + 1;
        });
      }, 1000);
    } catch {
      toast({ title: "Microphone access nahi mila", variant: "destructive" });
    }
  };

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    setRecordSeconds(0);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const cancelRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    setRecordSeconds(0);
    if (mediaRecorderRef.current?.state === "recording") {
      chunksRef.current = [];
      mediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop());
      mediaRecorderRef.current = null;
    }
  };

  const displayName = (otherUser as any)?.name || (otherUser as any)?.mobile || `User #${otherId}`;
  const avatarUrl = (otherUser as any)?.avatarUrl;
  const isOnline = (otherUser as any)?.isOnline;

  const groupedMessages = () => {
    if (!messages) return [];
    const groups: { date: string; msgs: Msg[] }[] = [];
    let curDate = "";
    for (const m of (messages as Msg[])) {
      const d = format(new Date(m.createdAt), "dd MMM yyyy");
      if (d !== curDate) {
        curDate = d;
        groups.push({ date: d, msgs: [m] });
      } else {
        groups[groups.length - 1].msgs.push(m);
      }
    }
    return groups;
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground px-4 pt-10 pb-3 shadow-md">
        <div className="flex items-center gap-3">
          <button onClick={() => setLocation("/chat")} className="p-1">
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="relative shrink-0">
            <div className="h-10 w-10 rounded-full overflow-hidden bg-white/20 flex items-center justify-center">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <span className="font-bold text-base">{displayName.charAt(0).toUpperCase()}</span>
              )}
            </div>
            {isOnline && (
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 bg-green-400 border-2 border-primary rounded-full" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base truncate">{displayName}</p>
            <p className="text-primary-foreground/70 text-xs">
              {isOnline ? "Online" : "Offline"}
            </p>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowMenu((v) => !v)}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 bg-card text-foreground border border-border rounded-2xl shadow-xl z-50 overflow-hidden min-w-[160px]">
                {!clearConfirm ? (
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-destructive/10 text-destructive transition-colors"
                    onClick={() => setClearConfirm(true)}
                  >
                    <Trash2 className="w-4 h-4" /> Chat Clear Karo
                  </button>
                ) : (
                  <div className="p-3">
                    <p className="text-xs text-muted-foreground mb-2 text-center">Pakka? Saare messages hat jayenge</p>
                    <div className="flex gap-2">
                      <button
                        className="flex-1 py-2 text-xs bg-destructive text-white rounded-xl font-semibold"
                        onClick={handleClearChat}
                        disabled={clearing}
                      >
                        {clearing ? "..." : "Haan"}
                      </button>
                      <button
                        className="flex-1 py-2 text-xs bg-muted rounded-xl text-sm"
                        onClick={() => { setClearConfirm(false); setShowMenu(false); }}
                      >
                        Nahi
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`flex mb-3 ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
              <Skeleton className="h-10 w-48 rounded-2xl" />
            </div>
          ))
        ) : !(messages as Msg[])?.length ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">👋</div>
            <p className="text-muted-foreground font-medium">Pehla message bhejo</p>
          </div>
        ) : (
          groupedMessages().map(({ date, msgs }) => (
            <div key={date}>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-border" />
                <p className="text-xs text-muted-foreground font-medium px-2">{date}</p>
                <div className="flex-1 h-px bg-border" />
              </div>
              {msgs.map((msg) => {
                const isMe = msg.fromUserId === me?.id;
                const origMsg = msg.replyToId ? msgById.get(msg.replyToId) : undefined;
                return (
                  <div key={msg.id} className={`flex mb-2 items-end gap-1 ${isMe ? "justify-end" : "justify-start"}`}>
                    {!isMe && (
                      <UserAvatar userId={otherId} name={(otherUser as any)?.name} code={(otherUser as any)?.code} avatarUrl={avatarUrl} size="xs" className="mb-1" />
                    )}
                    <div className="flex flex-col max-w-[78%]">
                      {/* Reply quote */}
                      {msg.replyToId && (
                        <ReplyBubble msg={msg} origMsg={origMsg} isMe={isMe} />
                      )}
                      <div
                        className={`rounded-2xl px-3 py-2 shadow-sm ${
                          msg.replyToId ? "rounded-t-none" : ""
                        } ${
                          isMe
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-card border border-border rounded-bl-sm"
                        }`}
                      >
                        {msg.type === "voice" ? (
                          <VoicePlayer src={msg.content} />
                        ) : msg.type === "image" ? (
                          <img
                            src={msg.content}
                            alt="Photo"
                            className="max-w-full rounded-lg max-h-60 object-contain cursor-pointer"
                            onClick={() => window.open(msg.content, "_blank")}
                            loading="lazy"
                          />
                        ) : (
                          <p className="text-sm leading-relaxed break-words">{msg.content}</p>
                        )}
                        <div className="flex items-center justify-end gap-1 mt-1">
                          {/* Reply button — tap to reply */}
                          <button
                            onClick={() => handleReply(msg)}
                            className={`p-1 rounded-full opacity-50 hover:opacity-100 active:opacity-100 transition-opacity ${
                              isMe ? "text-white" : "text-muted-foreground"
                            }`}
                            title="Reply karo"
                          >
                            <Reply className="h-3.5 w-3.5" />
                          </button>
                          <span className={`text-[10px] ${isMe ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                            {format(new Date(msg.createdAt), "hh:mm a")}
                          </span>
                          {isMe && <MessageTick deliveredAt={msg.deliveredAt} readAt={msg.readAt} />}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply bar */}
      {replyTo && (
        <div className="bg-muted border-t border-border px-4 py-2.5 flex items-center gap-3">
          <Reply className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0 flex items-center gap-2">
            {replyTo.type === "image" && replyTo.imageSrc ? (
              <>
                <img src={replyTo.imageSrc} alt="reply" className="h-10 w-10 rounded object-cover shrink-0 border border-border" />
                <div>
                  <p className="text-xs font-semibold text-primary">Reply kar rahe ho</p>
                  <p className="text-xs text-muted-foreground">📷 Photo</p>
                </div>
              </>
            ) : replyTo.type === "voice" ? (
              <div>
                <p className="text-xs font-semibold text-primary">Reply kar rahe ho</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Mic className="h-3 w-3" /> Voice note
                </p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-semibold text-primary">Reply kar rahe ho</p>
                <p className="text-xs text-muted-foreground truncate">{replyTo.preview}</p>
              </div>
            )}
          </div>
          <button onClick={() => setReplyTo(null)} className="p-1 text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Input bar */}
      <div className="border-t border-border bg-card px-4 py-3">
        {recording ? (
          <div className="flex items-center gap-3">
            <button onClick={cancelRecording} className="p-2 text-red-500">
              <MicOff className="h-6 w-6" />
            </button>
            <div className="flex-1 bg-red-50 border border-red-200 rounded-full px-4 py-2.5 flex items-center gap-2">
              <span className="h-2.5 w-2.5 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-700 font-semibold text-sm">
                Recording... {recordSeconds}s / 30s
              </span>
            </div>
            <button
              onClick={stopRecording}
              className="p-2 bg-red-500 text-white rounded-full"
            >
              <Square className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {/* Image upload */}
            <button
              onClick={() => imgInputRef.current?.click()}
              disabled={sendMutation.isPending}
              className="p-2 text-muted-foreground hover:text-primary transition-colors shrink-0"
            >
              <ImageIcon className="h-5 w-5" />
            </button>
            <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />

            <Input
              placeholder="Message likho..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendText()}
              className="flex-1 h-11 rounded-full"
            />
            {text.trim() ? (
              <Button
                size="icon"
                className="h-11 w-11 rounded-full shrink-0"
                onClick={sendText}
                disabled={sendMutation.isPending}
              >
                <Send className="h-5 w-5" />
              </Button>
            ) : (
              <Button
                size="icon"
                variant="outline"
                className="h-11 w-11 rounded-full shrink-0"
                onClick={startRecording}
              >
                <Mic className="h-5 w-5 text-primary" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
