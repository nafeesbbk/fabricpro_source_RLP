import { useState, useCallback } from "react";

export function useTabOrder<T extends { id: string }>(
  key: string,
  defaultItems: T[]
): [T[], (newOrder: T[]) => void, () => void] {
  const load = (): T[] => {
    try {
      const saved = localStorage.getItem(key);
      if (!saved) return defaultItems;
      const ids: string[] = JSON.parse(saved);
      const map = new Map(defaultItems.map((item) => [item.id, item]));
      const ordered = ids.map((id) => map.get(id)).filter(Boolean) as T[];
      // Add any new items not in saved order
      const missing = defaultItems.filter((item) => !ids.includes(item.id));
      return [...ordered, ...missing];
    } catch {
      return defaultItems;
    }
  };

  const [items, setItems] = useState<T[]>(load);

  const save = useCallback(
    (newOrder: T[]) => {
      setItems(newOrder);
      localStorage.setItem(key, JSON.stringify(newOrder.map((i) => i.id)));
    },
    [key]
  );

  const reset = useCallback(() => {
    localStorage.removeItem(key);
    setItems(defaultItems);
  }, [key, defaultItems]);

  return [items, save, reset];
}
