"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Contest, LeaderboardEntry, User } from "@/lib/types";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Loader2, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function LeaderboardPage() {
  const [contests, setContests] = useState<Contest[]>([]);
  const [selectedContest, setSelectedContest] = useState<string>("");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);

  // 🔹 Fetch contests from Firestore
  useEffect(() => {
    async function fetchContests() {
      setIsLoading(true);
      try {
        const contestsSnapshot = await getDocs(collection(db, "contests"));
        const contestsList = contestsSnapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as Contest)
        );
        setContests(contestsList);
        if (contestsList.length > 0) setSelectedContest(contestsList[0].id);
      } catch (error) {
        console.error("Error fetching contests:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchContests();
  }, []);

  // 🔹 Fetch leaderboard for selected contest
  useEffect(() => {
    async function fetchLeaderboard() {
      if (!selectedContest) return;
      setIsLeaderboardLoading(true);

      try {
        // ✅ Get all correct submissions for selected contest
        const submissionsQuery = query(
          collection(db, "submissions"),
          where("contestId", "==", selectedContest),
          where("status", "==", "correct")
        );
        const submissionsSnapshot = await getDocs(submissionsQuery);

        // ✅ Calculate total score per user
        const scores: Record<string, number> = {};
        submissionsSnapshot.forEach((doc) => {
          const submission = doc.data();
          scores[submission.userId] =
            (scores[submission.userId] || 0) + 10; // 10 pts per correct answer
        });

        // ✅ Get user info from "users" collection
        const usersSnapshot = await getDocs(collection(db, "users"));
        const usersMap = new Map<string, User>();
        usersSnapshot.forEach((doc) => {
          usersMap.set(doc.id, doc.data() as User);
        });

        // ✅ Merge scores + user details
        const leaderboardData: LeaderboardEntry[] = Object.entries(scores)
          .map(([userId, score]) => {
            const user = usersMap.get(userId);
            return {
              id: userId,
              userId,
              userName: user?.name || "Unknown",
              regNo: user?.regNo || "-",
              department: user?.department || "-",
              contestId: selectedContest,
              score,
            };
          })
          .sort((a, b) => b.score - a.score);

        // ✅ Assign rank numbers
        setLeaderboard(
          leaderboardData.map((entry, index) => ({
            ...entry,
            rank: index + 1,
          }))
        );
      } catch (error) {
        console.error("Error fetching leaderboard:", error);
      } finally {
        setIsLeaderboardLoading(false);
      }
    }

    fetchLeaderboard();
  }, [selectedContest]);

  // 🔹 Rank icons for top 3
  const getRankBadge = (rank: number) => {
    if (rank === 1) return <Trophy className="h-5 w-5 text-yellow-500" />;
    if (rank === 2) return <Trophy className="h-5 w-5 text-gray-400" />;
    if (rank === 3) return <Trophy className="h-5 w-5 text-amber-700" />;
    return (
      <Badge
        variant="secondary"
        className="w-6 h-6 flex items-center justify-center"
      >
        {rank}
      </Badge>
    );
  };

  return (
    <div>
      {/* 🔹 Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Contest Leaderboard
          </h1>
          <p className="text-muted-foreground">
            Check rankings for each contest.
          </p>
        </div>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Select value={selectedContest} onValueChange={setSelectedContest}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select a contest" />
            </SelectTrigger>
            <SelectContent>
              {contests.map((contest) => (
                <SelectItem key={contest.id} value={contest.id}>
                  {contest.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* 🔹 Leaderboard Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px] text-center">Rank</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Register Number</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="text-right">Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLeaderboardLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
                  <Loader2 className="mx-auto my-8 h-6 w-6 animate-spin text-primary" />
                </TableCell>
              </TableRow>
            ) : leaderboard.length > 0 ? (
              leaderboard.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium text-center">
                    {getRankBadge(entry.rank!)}
                  </TableCell>
                  <TableCell>{entry.userName}</TableCell>
                  <TableCell>{entry.regNo}</TableCell>
                  <TableCell>{entry.department}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {entry.score}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <Trophy className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                  No scores yet for this contest.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
