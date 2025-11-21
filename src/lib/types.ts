import type { User as FirebaseUser } from 'firebase/auth';

export interface User {
  uid: string;
  email: string | null;
  name: string | null;
  regNo: string | null;
  department: string | null;
  role: 'admin' | 'user';
}

export interface Contest {
  id: string;
  name: string;
  duration: number; // in minutes
  createdBy: string;
  createdAt: any;
}

export interface Question {
  id: string;
  contestId: string;
  title: string;
  description: string;
  constraints: string;
  sampleInput: string;
  sampleOutput: string;
  level: 1 | 2 | 3;
}

export interface Submission {
  id: string;
  contestId: string;
  questionId: string;
  userId: string;
  code: string;
  language: string;
  status: 'correct' | 'incorrect';
  submittedAt: any;
}

export interface LeaderboardEntry {
  id: string;
  userId: string;
  userName: string;
  contestId: string;
  score: number;
  rank?: number;
}

export interface AuthContextType {
  user: FirebaseUser | null;
  userData: User | null;
  role: 'admin' | 'user' | null;
  loading: boolean;
}

    