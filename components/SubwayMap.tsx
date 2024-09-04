import React, { useEffect, useState } from "react";

// Subway stop data for Line 1, 2, and 3
const subwayStops = {
  "1": ["South Ferry", "Chambers St", "34th St - Penn Station", "Times Sq - 42nd St", "125th St"],
  "2": ["Flatbush Av", "Atlantic Av - Barclays", "34th St - Penn Station", "Times Sq - 42nd St", "125th St"],
  "3": ["New Lots Av", "Atlantic Av - Barclays", "34th St - Penn Station", "Times Sq - 42nd St", "148th St"],
};

const SubwayLine = ({ lineColor, stops }) => {
  const [positionTop, setPositionTop] = useState(0);
  const [positionBottom, setPositionBottom] = useState(100);

  useEffect(() => {
    const interval = setInterval(() => {
      setPositionTop((prev) => (prev > 100 ? 0 : prev + 1)); // Move right
      setPositionBottom((prev) => (prev < 0 ? 100 : prev - 1)); // Move left
    }, 50); // Adjust speed as necessary

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative h-20 mb-12 mx-10">
      {/* Subway Line */}
      <div
        className={`relative w-full h-2 ${lineColor || "bg-black"} `}
      />

      {/* Subway Cars Moving Top to Right */}
      <div
        className="absolute h-4 w-10 bg-blue-500 top-3 transition-left duration-75"
        style={{ left: `${positionTop}%` }}
      />

      {/* Subway Cars Moving Bottom to Left */}
      <div
        className="absolute h-4 w-10 bg-red-500 bottom-3 transition-left duration-75"
        style={{ left: `${positionBottom}%` }}
      />

      {/* Render Subway Stops */}
      {stops.map((stop, index) => {
        const position = (index / (stops.length - 1)) * 100; // Calculate position between 0% and 100%
        return (
          <div
            key={index}
            className="absolute text-center "
            style={{ left: `${position}%`}}
          >
            {/* Stop Marker */}
            <div className="w-2.5 h-2.5 bg-black rounded-full mb-1" />
            {/* Stop Name */}
            <div className="text-xs">{stop}</div>
          </div>
        );
      })}
    </div>
  );
};

const SubwayMap = () => {
  return (
    <div className="p-5">
      {/* Line 1 */}
      <SubwayLine lineColor="bg-red-600" stops={subwayStops["1"]} />
      {/* Line 2 */}
      <SubwayLine lineColor="bg-red-600" stops={subwayStops["2"]} />
      {/* Line 3 */}
      <SubwayLine lineColor="bg-red-600" stops={subwayStops["3"]} />
    </div>
  );
};

export default SubwayMap;
