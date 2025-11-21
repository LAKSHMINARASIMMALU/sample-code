import { doc, getDoc, collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { notFound } from 'next/navigation';
import type { Contest, Question } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, HelpCircle } from 'lucide-react';
import StartContestButton from './StartContestButton';

async function getContestDetails(contestId: string, userId: string) {
    const contestRef = doc(db, 'contests', contestId);
    const contestSnap = await getDoc(contestRef);

    if (!contestSnap.exists()) return null;
    const contest = { id: contestSnap.id, ...contestSnap.data() } as Contest;

    const questionsQuery = query(collection(db, `contests/${contestId}/questions`), orderBy('level'));
    const questionsSnap = await getDocs(questionsQuery);
    const questions = questionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question));

    // Check if user already attempted or ended contest
    const userContestRef = doc(db, `user_contests/${userId}_${contestId}`);
    const userContestSnap = await getDoc(userContestRef);
    const isLocked = userContestSnap.exists() && userContestSnap.data()?.status === 'ended';

    return { contest, questions, isLocked };
}

export default async function ContestPage({ params, searchParams }: { params: { contestId: string }, searchParams: any }) {
    const userId = searchParams.userId as string; // pass userId from auth
    const data = await getContestDetails(params.contestId, userId);

    if (!data) notFound();

    const { contest, questions, isLocked } = data;

    return (
        <div className="container mx-auto max-w-4xl py-8">
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle className="text-4xl font-headline text-center">{contest.name}</CardTitle>
                    <CardDescription className="text-center text-lg flex items-center justify-center gap-2 pt-2">
                        <Clock className="h-5 w-5" /> {contest.duration} minutes
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="mb-8">
                        <h3 className="text-2xl font-semibold mb-4 flex items-center">
                            <HelpCircle className="h-6 w-6 mr-3 text-primary" />
                            Questions
                        </h3>
                        <div className="space-y-3">
                            {questions.map((q, index) => (
                                <div key={q.id} className="flex items-center justify-between p-3 rounded-md bg-secondary/50">
                                    <p className="font-medium">Question {index + 1}: {q.title}</p>
                                    <div className={`text-sm font-semibold px-2 py-1 rounded-full ${
                                        q.level === 1 ? 'bg-green-100 text-green-800' :
                                        q.level === 2 ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-red-100 text-red-800'
                                    }`}>
                                        Level {q.level}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-8 border-t pt-6 text-center space-y-4">
                        {isLocked ? (
                            <p className="text-red-600 font-semibold">
                                You have already completed this contest. You cannot participate again.
                            </p>
                        ) : (
                            <StartContestButton 
                                contestId={contest.id} 
                                userId={userId} 
                                duration={contest.duration} 
                            />
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
