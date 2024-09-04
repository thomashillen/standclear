"use client"; // Add this line at the top

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button"; // Example Shadcn UI component
import Head from "next/head";
import SubwayMap from "@/components/SubwayMap"; // Import the SubwayMap component

const Home = () => {
  const [subwayData, setSubwayData] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/trains");
        const data = await res.json();
        setSubwayData(data);
      } catch (error) {
        console.error("Error fetching subway data:", error);
      }
    };
    fetchData();
  }, []);

  return (
    <div>
      <Head>
        <title>SubwaySurfer</title>
        <meta name="description" content="Real-time NYC subway tracker" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <header className="h-[10vh] flex justify-between items-center p-4">
        <h1 className="text-3xl font-bold">SubwaySurfer</h1>
        <Button onClick={() => alert("More features coming soon!")}>
          Learn More
        </Button>
      </header>

      <main className="h-[80vh] mx-10 border">
        {/* Render the subway map with moving cars */}
        <div>
          <SubwayMap subwayData={subwayData} />
        </div>
      </main>

      <footer className="h-[10vh] p-4 text-center">
        <p>&copy; 2024 SubwaySurfer</p>
      </footer>
    </div>
  );
};

export default Home;
