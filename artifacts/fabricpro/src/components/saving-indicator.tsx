import { useIsMutating } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

export function SavingIndicator() {
  const isMutating = useIsMutating();
  const saving = isMutating > 0;

  return (
    <>
      {/* Top shimmer progress bar */}
      <AnimatePresence>
        {saving && (
          <motion.div
            key="progress-bar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed top-0 left-0 right-0 h-0.5 z-[100] overflow-hidden"
          >
            <motion.div
              className="absolute inset-y-0 left-0 right-0 bg-gradient-to-r from-transparent via-orange-400 to-transparent"
              animate={{ x: ["-100%", "100%"] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="absolute inset-0 bg-orange-200/60" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating saving pill */}
      <AnimatePresence>
        {saving && (
          <motion.div
            key="saving-pill"
            initial={{ opacity: 0, y: -12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.9 }}
            transition={{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }}
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[100]"
          >
            <div className="flex items-center gap-2 bg-zinc-900/90 backdrop-blur-md text-white text-xs font-semibold px-3.5 py-2 rounded-full shadow-lg shadow-black/20 border border-white/10">
              <motion.span
                className="h-3.5 w-3.5 rounded-full border-2 border-orange-400 border-t-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                style={{ display: "inline-block" }}
              />
              Saving...
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
