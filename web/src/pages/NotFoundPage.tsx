import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-start gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          404
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Page not found
        </h1>
        <p className="text-sm text-muted-foreground">
          That route doesn’t exist in the visual-regression UI.
        </p>
      </div>
      <Button render={<Link to="/" />} variant="outline">
        Back to New comparison
      </Button>
    </div>
  );
}
