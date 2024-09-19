import React, { useState } from "react";
import SubwayLine from "./SubwayLine";

// Expanded subway stop data for all NYC subway lines
const subwayStops = {
  "1": ["South Ferry", "Chambers St", "34th St - Penn Station", "Times Sq - 42nd St", "125th St"],
  "2": ["Flatbush Av", "Atlantic Av - Barclays", "34th St - Penn Station", "Times Sq - 42nd St", "125th St"],
  "3": ["New Lots Av", "Atlantic Av - Barclays", "34th St - Penn Station", "Times Sq - 42nd St", "148th St"],
  "4": ["Crown Heights", "Atlantic Av - Barclays", "14th St - Union Sq", "Grand Central - 42nd St", "125th St"],
  "5": ["Flatbush Av", "Atlantic Av - Barclays", "14th St - Union Sq", "Grand Central - 42nd St", "125th St"],
  "6": ["Brooklyn Bridge", "14th St - Union Sq", "Grand Central - 42nd St", "125th St", "Pelham Bay Park"],
  "7": ["34th St - Hudson Yards", "Times Sq - 42nd St", "Grand Central - 42nd St", "Queensboro Plaza", "Flushing - Main St"],
  "A": ["Far Rockaway", "Broadway Junction", "14th St", "59th St - Columbus Circle", "Inwood - 207th St"],
  "C": ["Euclid Av", "Broadway Junction", "14th St", "59th St - Columbus Circle", "168th St"],
  "E": ["World Trade Center", "14th St", "34th St - Penn Station", "Jackson Heights - Roosevelt Av", "Jamaica Center"],
  "B": ["Brighton Beach", "Atlantic Av - Barclays", "34th St - Herald Sq", "59th St - Columbus Circle", "145th St"],
  "D": ["Coney Island", "Atlantic Av - Barclays", "34th St - Herald Sq", "59th St - Columbus Circle", "161st St - Yankee Stadium"],
  "F": ["Coney Island", "Church Av", "14th St", "34th St - Herald Sq", "Jamaica - 179th St"],
  "M": ["Middle Village", "Myrtle - Wyckoff Avs", "14th St", "34th St - Herald Sq", "Forest Hills - 71st Av"],
  "N": ["Coney Island", "Atlantic Av - Barclays", "34th St - Herald Sq", "Times Sq - 42nd St", "Astoria - Ditmars Blvd"],
  "Q": ["Coney Island", "Atlantic Av - Barclays", "34th St - Herald Sq", "Times Sq - 42nd St", "96th St"],
  "R": ["Bay Ridge - 95th St", "Atlantic Av - Barclays", "34th St - Herald Sq", "Times Sq - 42nd St", "Forest Hills - 71st Av"],
  "W": ["Whitehall St", "Atlantic Av - Barclays", "34th St - Herald Sq", "Times Sq - 42nd St", "Astoria - Ditmars Blvd"],
  "J": ["Broad St", "Broadway Junction", "Marcy Av", "Essex St", "Jamaica Center"],
  "Z": ["Broad St", "Broadway Junction", "Marcy Av", "Essex St", "Jamaica Center"],
  "L": ["8th Av", "14th St - Union Sq", "1st Av", "Bedford Av", "Canarsie - Rockaway Pkwy"],
  "G": ["Court Sq", "Hoyt - Schermerhorn Sts", "Bedford - Nostrand Avs", "Myrtle - Willoughby Avs", "Church Av"],
  "S": ["Times Sq - 42nd St", "Grand Central - 42nd St"],
};

const lineColors = {
  "1": "#EE352E", "2": "#EE352E", "3": "#EE352E",
  "4": "#00933C", "5": "#00933C", "6": "#00933C",
  "7": "#B933AD",
  "A": "#0039A6", "C": "#0039A6", "E": "#0039A6",
  "B": "#FF6319", "D": "#FF6319", "F": "#FF6319", "M": "#FF6319",
  "N": "#FCCC0A", "Q": "#FCCC0A", "R": "#FCCC0A", "W": "#FCCC0A",
  "J": "#996633", "Z": "#996633",
  "L": "#A7A9AC",
  "G": "#6CBE45",
  "S": "#808183",
};

const SubwayMap: React.FC = () => {
  const [selectedLine, setSelectedLine] = useState<string | null>(null);

  const handleLineClick = (line: string) => {
    setSelectedLine(line === selectedLine ? null : line);
  };

  return (
    <div className="p-5">
      <div className="flex flex-wrap justify-center gap-4 mb-8">
        {Object.keys(subwayStops).map((line) => (
          <button
            key={line}
            className={`w-12 h-12 rounded-full text-white font-bold ${
              selectedLine === line ? "ring-4 ring-blue-300" : ""
            }`}
            style={{ backgroundColor: lineColors[line as keyof typeof lineColors] }}
            onClick={() => handleLineClick(line)}
          >
            {line}
          </button>
        ))}
      </div>
      {selectedLine && (
        <SubwayLine
          lineColor={lineColors[selectedLine as keyof typeof lineColors]}
          stops={subwayStops[selectedLine as keyof typeof subwayStops]}
        />
      )}
    </div>
  );
};

export default SubwayMap;
