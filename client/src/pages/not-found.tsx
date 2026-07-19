import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SPRING_SLOW, fadeUp } from "@/lib/motion";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="relative isolate flex min-h-screen w-full items-center justify-center bg-background px-4">
      <motion.div
        className="w-full max-w-sm"
        {...fadeUp}
        transition={SPRING_SLOW}
      >
        <Card className="rounded-3xl text-center shadow-lg">
          <CardContent className="pb-8 pt-10">
            <p className="mb-2 font-display text-7xl font-bold tracking-tight text-primary">404</p>
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
