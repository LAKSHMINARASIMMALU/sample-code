"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface StartContestButtonProps {
  contestId: string;
  userId: string;
  duration: number;
}

export default function StartContestButton({ contestId, userId, duration }: StartContestButtonProps) {
  const router = useRouter();

  const handleStartContest = async () => {
    try {
      // Lock contest as started in Firestore
      await setDoc(
        doc(db, `user_contests/${userId}_${contestId}`),
        { status: "started", startedAt: serverTimestamp(), duration },
        { merge: true }
      );

      // Redirect to live contest page
      router.push(`/contest/${contestId}/live?userId=${userId}`);
    } catch (err) {
      console.error(err);
      alert("Failed to start contest. Please try again.");
    }
  };

  return (
    <Button size="lg" onClick={handleStartContest}>
      Start Contest <ArrowRight className="ml-2 h-5 w-5" />
    </Button>
  );
}
