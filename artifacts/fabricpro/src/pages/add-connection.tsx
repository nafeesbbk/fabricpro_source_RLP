import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLookupUserByCode, getLookupUserByCodeQueryKey, useSendConnectionRequest, ConnectionRequestRoleLabel } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Search, UserPlus, Smartphone, MessageCircle } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useQueryClient } from "@tanstack/react-query";

type ContactResult = {
  mobile: string;
  displayName: string;
  registered: boolean;
  name?: string;
  code?: string;
};

function normalizeMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits.slice(-10);
}

export default function AddConnection() {
  const [code, setCode] = useState("");
  const [searchCode, setSearchCode] = useState("");
  const [roleLabel, setRoleLabel] = useState<ConnectionRequestRoleLabel>("karigar");
  const [contactRoles, setContactRoles] = useState<Record<string, ConnectionRequestRoleLabel>>({});
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Phone contacts state
  const [contactResults, setContactResults] = useState<ContactResult[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [requestingSent, setRequestingSent] = useState<Set<string>>(new Set());

  const { data: foundUser, isLoading: isSearching, isError } = useLookupUserByCode(
    { code: searchCode },
    {
      query: {
        enabled: searchCode.length >= 4,
        queryKey: getLookupUserByCodeQueryKey({ code: searchCode }),
        retry: false
      }
    }
  );

  const sendRequestMutation = useSendConnectionRequest();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length >= 4) {
      setSearchCode(code.trim().toUpperCase());
    }
  };

  const handleSendRequest = () => {
    if (!foundUser) return;
    sendRequestMutation.mutate(
      { data: { userCode: foundUser.code, roleLabel } },
      {
        onSuccess: () => {
          toast({ title: "Request Bhej Di!", description: `${foundUser.name} ko connection request gayi` });
          setLocation("/connections");
        },
        onError: (err: any) => {
          toast({ title: "Request Fail", description: err?.message || "Dobara try karo", variant: "destructive" });
        }
      }
    );
  };

  const handleSendContactRequest = (contact: ContactResult) => {
    if (!contact.code) return;
    const role = contactRoles[contact.mobile] ?? "karigar";
    setRequestingSent((prev) => new Set([...prev, contact.mobile]));
    sendRequestMutation.mutate(
      { data: { userCode: contact.code, roleLabel: role } },
      {
        onSuccess: () => {
          toast({ title: "Request Bhej Di!", description: `${contact.name} ko connection request gayi` });
          setContactResults((prev) => prev.filter((c) => c.mobile !== contact.mobile));
        },
        onError: (err: any) => {
          setRequestingSent((prev) => { const s = new Set(prev); s.delete(contact.mobile); return s; });
          toast({ title: "Request Fail", description: err?.message || "Dobara try karo", variant: "destructive" });
        }
      }
    );
  };

  const pickPhoneContacts = async () => {
    const nav = navigator as any;
    if (!nav.contacts?.select) {
      toast({
        title: "Is device par support nahi",
        description: "Aapke browser mein phone contacts feature nahi hai. Neeche manually mobile number se search karo.",
        variant: "destructive"
      });
      return;
    }
    setContactsLoading(true);
    try {
      const selected: { name: string[]; tel: string[] }[] = await nav.contacts.select(["name", "tel"], { multiple: true });
      if (!selected || selected.length === 0) { setContactsLoading(false); return; }

      const token = localStorage.getItem("fabricpro_token") ?? "";
      const results: ContactResult[] = [];

      for (const contact of selected) {
        const displayName = contact.name?.[0] ?? "Unknown";
        const phones = contact.tel ?? [];
        for (const phone of phones) {
          const mobile = normalizeMobile(phone);
          if (mobile.length !== 10) continue;
          try {
            const res = await fetch(`/api/users/lookup-by-mobile?mobile=${mobile}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            results.push({
              mobile,
              displayName,
              registered: data.registered,
              name: data.name,
              code: data.code,
            });
          } catch {
            results.push({ mobile, displayName, registered: false });
          }
        }
      }
      setContactResults(results);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast({ title: "Contacts load nahi hua", variant: "destructive" });
      }
    } finally {
      setContactsLoading(false);
    }
  };

  const supportsContacts = typeof navigator !== "undefined" && !!(navigator as any).contacts;

  return (
    <Layout>
      <div className="p-4 max-w-lg mx-auto space-y-8">
        <div className="flex items-center mb-2">
          <Link href="/connections" className="mr-3 p-2 rounded-full hover:bg-accent">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold">Connection Add Karo</h1>
        </div>

        {/* Phone Contacts Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            <h2 className="font-bold text-base">Phone Contacts Se Dhundho</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Apni phone ki contact list se log select karo — jo FabricPro par hain unhe add karo, baaki ko WhatsApp se invite karo.
          </p>
          <Button
            onClick={pickPhoneContacts}
            disabled={contactsLoading}
            className="w-full h-12 gap-2"
            variant={supportsContacts ? "default" : "outline"}
          >
            <Smartphone className="h-5 w-5" />
            {contactsLoading ? "Contacts check ho rahe hain..." : "Phone Contacts Se Chunho"}
          </Button>
          {!supportsContacts && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Yeh feature sirf Android Chrome ya iOS Safari 14.5+ par kaam karta hai. Neeche code se manual search karo.
            </p>
          )}
        </div>

        {/* Contact Results */}
        {contactResults.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wide">
              {contactResults.length} Contact{contactResults.length > 1 ? "s" : ""} Mila
            </h3>
            {contactResults.map((contact) => (
              <Card key={`${contact.mobile}-${contact.displayName}`} className={`border ${contact.registered ? "border-primary/20" : "border-border"}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <Avatar className="h-11 w-11">
                      <AvatarFallback className={`font-bold text-base ${contact.registered ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                        {(contact.name ?? contact.displayName).charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{contact.registered ? contact.name : contact.displayName}</p>
                      <p className="text-xs text-muted-foreground">📱 +91 {contact.mobile}</p>
                      {contact.registered ? (
                        <p className="text-xs text-green-600 font-semibold">✅ FabricPro par registered hai</p>
                      ) : (
                        <p className="text-xs text-amber-600">❌ FabricPro par nahi hai abhi</p>
                      )}
                    </div>
                  </div>

                  {contact.registered ? (
                    <>
                      <div className="mb-3">
                        <Label className="text-xs font-semibold text-muted-foreground mb-2 block">Yeh aapke liye kaun hai?</Label>
                        <RadioGroup
                          value={contactRoles[contact.mobile] ?? "karigar"}
                          onValueChange={(v) => setContactRoles((prev) => ({ ...prev, [contact.mobile]: v as ConnectionRequestRoleLabel }))}
                          className="grid grid-cols-2 gap-2"
                        >
                          {(["seth", "karigar"] as const).map((r) => (
                            <div key={r}>
                              <RadioGroupItem value={r} id={`${contact.mobile}-${r}`} className="peer sr-only" />
                              <Label
                                htmlFor={`${contact.mobile}-${r}`}
                                className="flex items-center justify-center rounded-lg border-2 border-muted bg-popover p-2.5 text-sm font-semibold peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer"
                              >
                                {r === "seth" ? "Seth ji" : "Karigar"}
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                      <Button
                        className="w-full gap-2"
                        size="sm"
                        disabled={requestingSent.has(contact.mobile)}
                        onClick={() => handleSendContactRequest(contact)}
                      >
                        <UserPlus className="h-4 w-4" />
                        {requestingSent.has(contact.mobile) ? "Bhej diya..." : "Connection Request Bhejo"}
                      </Button>
                    </>
                  ) : (
                    <a
                      href={`https://wa.me/91${contact.mobile}?text=${encodeURIComponent(`Bhai, FabricPro use karo! Job work aur payment track karne ke liye behtareen app hai. Yahaan se download karo: https://fabric-flow-management--adeenadupatta.replit.app`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full h-10 rounded-lg bg-[#25D366] text-white font-semibold text-sm"
                    >
                      <MessageCircle className="h-4 w-4" />
                      WhatsApp se Invite Karo
                    </a>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground font-medium">YA USER CODE SE DHUNDHO</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Code search */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            <h2 className="font-bold text-base">User Code Se Dhundho</h2>
          </div>
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="User Code daalo (jaise: A5F6840)"
                className="pl-10 h-12 text-base font-mono uppercase"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>
            <Button type="submit" className="h-12 px-5" disabled={code.length < 4 || isSearching}>
              {isSearching ? "..." : "Dhundho"}
            </Button>
          </form>
        </div>

        {isError && searchCode && (
          <div className="text-center p-5 bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
            <p className="font-semibold mb-1">User nahi mila</p>
            <p className="text-sm">Code check karke dobara try karo.</p>
          </div>
        )}

        {foundUser && (
          <Card className="border-primary/20 shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center gap-4 mb-5">
                <Avatar className="h-14 w-14 border-2 border-primary/20">
                  <AvatarFallback className="bg-primary/10 text-primary text-lg font-bold">
                    {foundUser.name?.charAt(0).toUpperCase() || foundUser.code.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-bold text-lg">{foundUser.name}</h3>
                  <p className="text-muted-foreground font-mono text-sm">{foundUser.code}</p>
                </div>
              </div>

              <div className="space-y-3 mb-5">
                <Label className="text-sm font-semibold">Yeh vyakti aapke liye kya hai?</Label>
                <RadioGroup value={roleLabel} onValueChange={(v) => setRoleLabel(v as ConnectionRequestRoleLabel)} className="grid grid-cols-2 gap-3">
                  <div>
                    <RadioGroupItem value="seth" id="role-seth" className="peer sr-only" />
                    <Label htmlFor="role-seth" className="flex flex-col items-center justify-between rounded-xl border-2 border-muted bg-popover p-4 hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer">
                      <span className="text-base font-bold mb-0.5">Seth ji</span>
                      <span className="text-xs text-muted-foreground text-center">Inse maal lete hain</span>
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="karigar" id="role-karigar" className="peer sr-only" />
                    <Label htmlFor="role-karigar" className="flex flex-col items-center justify-between rounded-xl border-2 border-muted bg-popover p-4 hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer">
                      <span className="text-base font-bold mb-0.5">Karigar</span>
                      <span className="text-xs text-muted-foreground text-center">Inko maal dete hain</span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <Button className="w-full h-12 text-base font-semibold" onClick={handleSendRequest} disabled={sendRequestMutation.isPending}>
                <UserPlus className="w-5 h-5 mr-2" />
                {sendRequestMutation.isPending ? "Bhej raha hoon..." : "Connection Request Bhejo"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
