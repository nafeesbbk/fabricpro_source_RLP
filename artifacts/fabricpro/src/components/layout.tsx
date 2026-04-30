import React, { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, FileText, Banknote, MessageCircle, UserCircle,
  ShieldCheck, Users, BarChart2, Images, GripVertical, X, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetMe } from "@workspace/api-client-react";
import { useSwipeNav, saveLastPath } from "@/hooks/use-swipe-nav";
import { useTabOrder } from "@/hooks/use-tab-order";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const ICON_MAP: Record<string, React.ElementType> = {
  "/": LayoutDashboard,
  "/slips": FileText,
  "/connections": Users,
  "/chat": MessageCircle,
  "/statement": BarChart2,
  "/payments": Banknote,
  "/admin": ShieldCheck,
  "/gallery": Images,
  "/profile": UserCircle,
};

const ALL_NAV_ITEMS = [
  { id: "/", label: "Home" },
  { id: "/slips", label: "Slips" },
  { id: "/connections", label: "Contacts" },
  { id: "/chat", label: "Chat" },
  { id: "/statement", label: "Statement" },
  { id: "/payments", label: "Payment" },
  { id: "/gallery", label: "Gallery" },
  { id: "/profile", label: "Profile" },
];

const ADMIN_NAV_ITEMS = [
  { id: "/", label: "Home" },
  { id: "/slips", label: "Slips" },
  { id: "/connections", label: "Contacts" },
  { id: "/chat", label: "Chat" },
  { id: "/statement", label: "Statement" },
  { id: "/admin", label: "Admin" },
  { id: "/gallery", label: "Gallery" },
  { id: "/profile", label: "Profile" },
];

function SortableNavRow({ item }: { item: { id: string; label: string } }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const Icon = ICON_MAP[item.id] ?? LayoutDashboard;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-3 p-3 bg-card rounded-xl border border-border mb-2",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <div {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing p-1">
        <GripVertical className="w-5 h-5 text-muted-foreground" />
      </div>
      <Icon className="w-5 h-5 text-foreground" />
      <span className="font-semibold text-sm flex-1">{item.label}</span>
    </div>
  );
}

export function BottomNav() {
  const [location] = useLocation();
  const { data: me } = useGetMe();
  const isAdmin = me?.role === "super_admin";
  const defaultItems = isAdmin ? ADMIN_NAV_ITEMS : ALL_NAV_ITEMS;

  const storageKey = isAdmin ? "nav-order-admin" : "nav-order-user";
  const [navItems, setNavItems, resetNavItems] = useTabOrder(storageKey, defaultItems);
  const [editMode, setEditMode] = useState(false);
  const [tempItems, setTempItems] = useState(navItems);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const openEdit = () => {
    setTempItems(navItems);
    setEditMode(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = tempItems.findIndex((i) => i.id === active.id);
      const newIndex = tempItems.findIndex((i) => i.id === over.id);
      setTempItems(arrayMove(tempItems, oldIndex, newIndex));
    }
  };

  const handleSave = () => {
    setNavItems(tempItems);
    setEditMode(false);
  };

  const handleReset = () => {
    resetNavItems();
    setTempItems(defaultItems);
    setEditMode(false);
  };

  // Long press on nav bar to open edit mode
  const onTouchStart = () => {
    longPressRef.current = setTimeout(openEdit, 700);
  };
  const onTouchEnd = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  };

  return (
    <>
      {/* Edit Modal */}
      {editMode && (
        <div className="fixed inset-0 z-[100] flex flex-col">
          <div className="flex-1 bg-black/40" onClick={handleSave} />
          <div className="bg-background rounded-t-3xl p-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-black text-base">Nav Tabs Arrange Karo</h2>
              <div className="flex gap-2">
                <button onClick={handleReset} className="flex items-center gap-1 text-xs text-muted-foreground border border-border rounded-full px-3 py-1.5">
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
                <button onClick={handleSave} className="bg-primary text-primary-foreground text-xs font-bold rounded-full px-4 py-1.5">
                  Done
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-3">Grip icon se drag karke tabs ka order badlo</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={tempItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                {tempItems.map((item) => (
                  <SortableNavRow key={item.id} item={item} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      )}

      {/* Bottom Nav Bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 bg-card border-t border-border pb-safe z-50"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchEnd}
      >
        <div className="flex items-center justify-around h-16">
          {navItems.map((item) => {
            const Icon = ICON_MAP[item.id] ?? LayoutDashboard;
            const isActive =
              location === item.id || (item.id !== "/" && location.startsWith(item.id));
            return (
              <Link
                key={item.id}
                href={item.id}
                className={cn(
                  "flex flex-col items-center justify-center w-full h-full space-y-1 text-[10px] transition-colors",
                  isActive
                    ? item.id === "/admin"
                      ? "text-purple-600"
                      : "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon
                  className={cn(
                    "w-5 h-5",
                    isActive && item.id !== "/admin" && "fill-primary/20",
                    isActive && item.id === "/admin" && "text-purple-600"
                  )}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  useSwipeNav();

  useEffect(() => {
    saveLastPath(location);
  }, [location]);

  return (
    <div className="min-h-[100dvh] pb-16 bg-background">
      {children}
      <BottomNav />
    </div>
  );
}
