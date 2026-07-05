import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Aurora } from "@/components/aurora";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="relative isolate flex min-h-screen w-full items-center justify-center bg-background px-4">
      <Aurora />
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: EASE }}
      >
        <Card className="rounded-3xl text-center shadow-lg">
          <CardContent className="pb-8 pt-10">
            <p className="text-gradient-brand mb-2 font-display text-7xl font-bold tracking-tight">404</p>
            <h1 className="mb-2 text-xl font-bold text-foreground">ページが見つかりません</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              このページは存在しないか、移動した可能性があります。
            </p>
            <Button onClick={() => setLocation("/")} data-testid="button-go-home">
              ホームへ戻る
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
