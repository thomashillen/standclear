import React, { useEffect, useState } from "react";

interface SubwayLineProps {
  lineColor: string;
  stops: string[];
}

const SubwayLine: React.FC<SubwayLineProps> = ({ lineColor, stops }) => {
  const [carPosition1, setCarPosition1] = useState(0);
  const [carPosition2, setCarPosition2] = useState(100);

  useEffect(() => {
    const interval = setInterval(() => {
      setCarPosition1((prev) => (prev >= 100 ? 0 : prev + 1));
      setCarPosition2((prev) => (prev <= 0 ? 100 : prev - 1));
    }, 50);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative h-32 mb-12">
      {/* Subway Line */}
      <div className={`absolute top-1/2 w-full h-4 ${lineColor}`} style={{ backgroundColor: lineColor }}>
        {/* Subway Car 1 */}
        <div
          className="absolute top-0 w-8 h-6 bg-gray-200 border-2 border-gray-600 rounded-sm transform -translate-y-1/2"
          style={{ left: `${carPosition1}%` }}
        />
        {/* Subway Car 2 */}
        <div
          className="absolute bottom-0 w-8 h-6 bg-gray-200 border-2 border-gray-600 rounded-sm transform translate-y-1/2"
          style={{ left: `${carPosition2}%` }}
        />
      </div>

      {/* Render Subway Stops */}
      {stops.map((stop, index) => {
        const position = (index / (stops.length - 1)) * 100;
        return (
          <div
            key={index}
            className="absolute text-center"
            style={{ left: `${position}%`, top: '50%' }}
          >
            {/* Stop Marker */}
            <div 
              className="w-3 h-3 rounded-full mb-1 mx-auto border-2 border-white"
              style={{ backgroundColor: lineColor }}
            />
            {/* Stop Name */}
            <div className="text-xs mt-6">{stop}</div>
          </div>
        );
      })}
    </div>
  );
};

export default SubwayLine;
