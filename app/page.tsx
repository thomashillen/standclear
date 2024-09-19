"use client"; // Add this line at the top

import React, { useState } from "react";
import { Button } from "@/components/ui/button"; // Example Shadcn UI component
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import Head from "next/head";
import SubwayMap from "@/components/SubwayMap"; // Import the SubwayMap component

const Home = () => {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <Head>
        <title>SubwaySurfer</title>
        <meta name="description" content="Real-time NYC subway tracker" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <header className="bg-gray-800 text-white p-4">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-3xl font-bold">SubwaySurfer</h1>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" >
                Learn More
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>About SubwaySurfer</DialogTitle>
                <DialogDescription>
                  SubwaySurfer is a real-time NYC subway tracker that allows you to visualize the movement of subway cars on each line. Our goal is to provide an intuitive and interactive way to monitor the NYC subway system in real-time.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4">
                <h4 className="font-semibold">Key Features:</h4>
                <ul className="list-disc list-inside mt-2">
                  <li>Real-time tracking of subway cars</li>
                  <li>Interactive map of all NYC subway lines</li>
                  <li>Detailed information about each subway line and its stops</li>
                  <li>User-friendly interface for easy navigation</li>
                </ul>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="flex-grow container mx-auto p-4">
        <h2 className="text-2xl font-semibold mb-4">NYC Subway Map</h2>
        <SubwayMap />
      </main>

      <footer className="bg-gray-800 text-white p-4 text-center">
        <p>&copy; 2024 SubwaySurfer</p>
      </footer>
    </div>
  );
};

export default Home;