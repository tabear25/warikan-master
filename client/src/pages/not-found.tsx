import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm text-center">
        <CardContent className="pt-10 pb-8">
          <p className="text-5xl mb-4">🔍</p>
          <h1 className="text-xl font-bold text-foreground mb-2">ページが見つかりません</h1>
          <p className="text-sm text-muted-foreground mb-6">
            このページは存在しないか、移動した可能性があります。
          </p>
          <Button onClick={() => setLocation("/")} data-testid="button-go-home">
            ホームへ戻る
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
