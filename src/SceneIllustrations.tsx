import type { ReactNode } from 'react'
import type { StampKind } from './stampDesign'

const ink = '#28262a'
const cream = '#fff4de'
const teal = '#008c95'
const blue = '#2855a6'
const pink = '#e95070'
const mustard = '#e7a928'
const green = '#4e8548'
const leaf = '#315f2e'
const sand = '#ecd5ad'

function Sea({ horizon = 85 }: { horizon?: number }) {
  return <>
    <path d={`M0 ${horizon}Q88 ${horizon - 9} 175 ${horizon}T350 ${horizon}V150H0Z`} fill={teal}/>
    <path d="M0 123q65-14 132 0t132 0t86 0v27H0Z" fill={blue}/>
    <path d="M18 105h29m8 0h11m188-3h36m-206 31h35m168 3h40" fill="none" stroke={cream} strokeWidth="2" strokeLinecap="round"/>
  </>
}

function Cloud({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <path transform={`translate(${x} ${y}) scale(${scale})`} d="M0 12a8 8 0 0 1 10-8 12 12 0 0 1 23-1 9 9 0 0 1 15 9Z" fill="#fffaf0"/>
}

function Birds({ x, y }: { x: number; y: number }) {
  return <path transform={`translate(${x} ${y})`} d="M0 5q5-5 10 0 5-5 10 0m10-10q4-4 8 0 4-4 8 0" fill="none" stroke={blue} strokeWidth="2" strokeLinecap="round"/>
}

function Plant({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M0 0q-23-7-20-24Q-2-22 0 0M0 0q-2-29 13-35Q22-15 0 0M0 0q10-23 26-17Q23-1 0 0" fill={leaf}/>
    <path d="M0 0q-8-18-3-33" fill="none" stroke={green} strokeWidth="3" strokeLinecap="round"/>
  </g>
}

function Sailboat({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M-31 0h64L20 14h-38Z" fill={pink}/>
    <path d="M0-53V0" stroke={ink} strokeWidth="2.5"/>
    <path d="M-5-49-29-7h24Z" fill={cream}/>
    <path d="M6-39 28-7H6Z" fill={mustard}/>
    <path d="M-23 5h43" stroke={cream} strokeWidth="2"/>
  </g>
}

function Penguin({ x, y, scale = 1, tilt = 0 }: { x: number; y: number; scale?: number; tilt?: number }) {
  return <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${scale})`}>
    <path d="m-9 25-9 7h16l2-6m8-1 10 7H4l-1-6" fill={mustard}/>
    <path d="M-18 0Q-35-4-33-22q10 13 19 12m31 9q18-12 16-25Q22-14 15-13" fill={ink}/>
    <path d="M-20 9c-2-16 2-25 4-35 2-23 30-23 33 0 2 10 7 23 3 35-5 23-35 22-40 0Z" fill={ink}/>
    <path d="M-12-14Q-20-27-9-32q6-2 9 6 3-8 9-6 11 5 3 18 15 24 3 35-14 10-28-1-10-12 1-34Z" fill="#fffaf0"/>
    <path d="M-13-3Q0 7 13-3" fill="none" stroke={ink} strokeWidth="4"/>
    <circle cx="-7" cy="-24" r="2.3" fill={ink}/>
    <circle cx="7" cy="-24" r="2.3" fill={ink}/>
    <path d="m-5-18 5 6 6-6Z" fill={mustard}/>
    <path d="M-11-20h3m11 0h3" stroke={pink} strokeWidth="2" strokeLinecap="round"/>
    <circle cx="-5" cy="12" r="1.5" fill={ink}/>
    <circle cx="6" cy="16" r="1.5" fill={ink}/>
  </g>
}

function MountainScene() {
  return <>
    <Cloud x={34} y={23}/><Cloud x={223} y={13} scale={0.65}/>
    <path d="m0 118 48-44 37 17 33-49h97l26 42 24-21 85 55v32H0Z" fill={teal}/>
    <path d="m85 91 33-49 31 58 66 50H0v-26Z" fill={pink}/>
    <path d="m215 42-20 65 46-23Z" fill="#006b72"/>
    <path d="M113 42h108" stroke={cream} strokeWidth="4" strokeLinecap="round"/>
    <path d="M214 48 302 110" stroke={blue} strokeWidth="1.8"/>
    <g transform="translate(247 76)">
      <path d="M0-5v10" stroke={ink} strokeWidth="2"/>
      <rect x="-10" y="3" width="22" height="19" rx="5" fill={mustard}/>
      <path d="M-7 6H9v8H-7Z" fill={cream}/>
      <path d="M1 6v8" stroke={teal} strokeWidth="2"/>
    </g>
    <path d="M0 133q80-23 167-1t183-6v24H0Z" fill={blue}/>
    <path d="M0 132q80-23 167-1t183-6" fill="none" stroke={cream} strokeWidth="3"/>
    <Plant x={39} y={148} scale={0.7}/>
  </>
}

function PenguinScene() {
  return <>
    <Cloud x={27} y={25}/><Birds x={228} y={43}/><Sea/>
    <path d="M0 128q61-37 140-10t210-11v43H0Z" fill={sand}/>
    <path d="M39 116Q27 74 70 78q32-15 47 39Z" fill="#b9b5a4"/>
    <path d="M41 111q7-33 34-29l-8 28Z" fill="#d5d1bd"/>
    <path d="M255 116q-7-40 26-48 38-12 53 42Z" fill="#b9b5a4"/>
    <path d="M272 112q-8-25 12-38 26 0 31 21Z" fill="#d5d1bd"/>
    <ellipse cx="163" cy="133" rx="61" ry="7" fill="#d5b993"/>
    <Penguin x={145} y={99} tilt={-7}/>
    <Penguin x={210} y={111} scale={0.72} tilt={9}/>
    <path d="m65 138 4-2m8 5 4-2m164-5 4 2m10-8 4 2" stroke="#b79a73" strokeWidth="2" strokeLinecap="round"/>
    <Plant x={314} y={149} scale={0.6}/>
  </>
}

function House({ x, y, color, door }: { x: number; y: number; color: string; door: string }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d="M0 0h61v105H0Z" fill={color}/>
    <path d="M-2 0h65v6H-2Z" fill={cream}/>
    <path d="M36 105V63a10 10 0 0 1 20 0v42Z" fill={door}/>
    <path d="M9 23h19v27H9Z" fill={cream}/>
    <path d="M12 26h13v21H12Z" fill={blue}/>
    <path d="M18 26v21m-6-11h13" stroke={cream} strokeWidth="2"/>
    <path d="M33 104h27m-30 5h33" stroke={cream} strokeWidth="3"/>
    <circle cx="50" cy="78" r="1.5" fill={mustard}/>
  </g>
}

function HouseScene() {
  return <>
    <path d="M0 81q102-87 209-13t141-9v91H0Z" fill="#d2dec0"/>
    <House x={-21} y={56} color={green} door={blue}/>
    <House x={43} y={39} color={pink} door={blue}/>
    <House x={107} y={23} color={teal} door={mustard}/>
    <House x={171} y={43} color={mustard} door={blue}/>
    <House x={235} y={32} color={blue} door={pink}/>
    <House x={299} y={52} color={pink} door={teal}/>
    <path d="M0 143 114 128l120 16 116-9v15H0Z" fill="#d4bd9b"/>
    <path d="m120 146 9-8m28 8 8-5m89 3 11-4m40 4 11-4" stroke={cream} strokeWidth="2"/>
    <Plant x={87} y={139} scale={0.47}/>
    <path d="m81 133 3 11h9l3-11Z" fill={mustard}/>
  </>
}

function CapeScene() {
  return <>
    <Cloud x={31} y={19}/><Sea horizon={65}/>
    <path d="M0 69 39 34l54 33 57-34 50 40 41 35-43 42H0Z" fill={green}/>
    <path d="m150 33 18 62 73 13-43 42H74l-16-43Z" fill={leaf}/>
    <path d="M-10 108q70-45 137 0t114 1" fill="none" stroke={sand} strokeWidth="19"/>
    <path d="M-10 108q70-45 137 0t114 1" fill="none" stroke={cream} strokeWidth="2" strokeDasharray="5 8"/>
    <g transform="translate(150 96) rotate(15)">
      <rect x="-29" y="-25" width="57" height="28" rx="6" fill={pink}/>
      <path d="M-24-20h45v12h-45Z" fill={cream}/>
      <path d="M-12-20v12m14-12v12m13-12v12" stroke={pink} strokeWidth="3"/>
      <circle cx="-16" cy="4" r="6" fill={ink}/><circle cx="18" cy="4" r="6" fill={ink}/>
      <circle cx="-16" cy="4" r="2" fill={cream}/><circle cx="18" cy="4" r="2" fill={cream}/>
    </g>
    <Sailboat x={291} y={103} scale={0.55}/>
    <Plant x={34} y={151} scale={0.65}/>
  </>
}

function LighthouseScene() {
  return <>
    <Cloud x={34} y={22}/><Sea horizon={87}/>
    <path d="m64 150 62-43 57-13 81 56Z" fill={green}/>
    <path d="m126 107 40 14-19 29H64Z" fill={leaf}/>
    <path d="m202 150-26-23 9-11" fill="none" stroke={sand} strokeWidth="6"/>
    <path d="m144 113 10-63h26l11 63Z" fill="#fffaf0"/>
    <path d="m149 82 34-1 3 14h-39Z" fill={pink}/>
    <path d="M164 99h9v14h-9Z" fill={blue}/>
    <path d="M151 36h31v17h-31Z" fill={blue}/>
    <path d="M156 39h21v11h-21Z" fill={mustard}/>
    <path d="M166 39v11" stroke={cream} strokeWidth="2"/>
    <path d="m145 36 22-15 22 15Z" fill={pink}/>
    <path d="M147 54h39m-19-33v-6" stroke={blue} strokeWidth="3" strokeLinecap="round"/>
    <path d="m150 44-47-10v21Zm33 0 47-10v21Z" fill={mustard} opacity=".28"/>
    <Birds x={244} y={65}/><Plant x={243} y={148} scale={0.75}/>
  </>
}

function RoadScene() {
  return <>
    <Sea horizon={69}/>
    <path d="M0 0h125l51 56 28-26 58 75-70 45H0Z" fill={green}/>
    <path d="M125 0 115 67l39 28 22-39Z" fill={leaf}/>
    <path d="m204 30 10 78 48-3Z" fill={teal}/>
    <path d="M125 25c-33 30-3 44 40 57s-38 38 16 68" fill="none" stroke={sand} strokeWidth="19"/>
    <path d="M125 25c-33 30-3 44 40 57s-38 38 16 68" fill="none" stroke={cream} strokeWidth="2" strokeDasharray="5 6"/>
    <g transform="translate(164 86) rotate(18)">
      <rect x="-15" y="-7" width="32" height="13" rx="4" fill={pink}/>
      <path d="m-9-7 5-8h12l5 8Z" fill={pink}/>
      <path d="m-5-8 3-5h8l4 5Z" fill={cream}/>
      <circle cx="-8" cy="6" r="4" fill={ink}/><circle cx="10" cy="6" r="4" fill={ink}/>
    </g>
    <path d="m212 125-7 4m13 5-7 4m-78-28 8-3" stroke={cream} strokeWidth="3" strokeLinecap="round"/>
    <Birds x={233} y={47}/><Plant x={39} y={147} scale={0.8}/>
  </>
}

function HarborScene() {
  return <>
    <Cloud x={52} y={15}/>
    <path d="m0 86 53-32 29 12 26-29h63l31 48Z" fill="#b5ccb8"/>
    <path d="M0 71h54v33H0Zm57-13h49v46H57Zm246 7h47v39h-47Z" fill={mustard}/>
    <path d="m-5 71 31-20 34 20m-7-13 28-20 30 20m187 7 26-18 29 18" fill={pink}/>
    <path d="M13 82h10v14H13Zm22 0h10v14H35Zm33-12h10v16H68Zm19 0h10v16H87Z" fill={cream}/>
    <Sea horizon={103}/>
    <Sailboat x={171} y={115} scale={1.15}/>
    <g transform="translate(273 116)">
      <path d="M-26 0h53L15 14h-29Z" fill={mustard}/>
      <path d="M-15-15h25V0h-25Z" fill={cream}/>
      <path d="M-11-12h8v8h-8Zm13 0h5v8H2Z" fill={blue}/>
      <path d="M9-15v-27l18 18" fill="none" stroke={blue} strokeWidth="2"/>
      <path d="M-19-15h32" stroke={pink} strokeWidth="3"/>
    </g>
    <path d="M0 136h71v14H0Z" fill={sand}/>
    <path d="M18 141v-16m35 16v-16" stroke={blue} strokeWidth="5" strokeLinecap="round"/>
  </>
}

function BeachHut({ x, color }: { x: number; color: string }) {
  return <g transform={`translate(${x} 58)`}>
    <path d="M4 46v14m33-14v14" stroke={ink} strokeWidth="3"/>
    <path d="M0 0h41v50H0Z" fill={color}/>
    <path d="m-4 0 24-20L45 0Z" fill={color}/>
    <path d="m-4 0 24-20L45 0" stroke={cream} strokeWidth="3" fill="none" strokeLinejoin="round"/>
    <path d="M13 16h16v34H13Z" fill={cream}/>
    <path d="M17 20h8v30h-8Z" fill={color}/>
    <path d="M7 8v31m28-31v31" stroke={cream} strokeWidth="1.5" opacity=".55"/>
    <circle cx="23" cy="35" r="1.5" fill={ink}/>
  </g>
}

function HutsScene() {
  return <>
    <Cloud x={24} y={20}/><Sea horizon={82}/>
    <path d="M0 118q74-15 173 0t177-7v39H0Z" fill={sand}/>
    <BeachHut x={58} color={pink}/><BeachHut x={103} color={mustard}/>
    <BeachHut x={148} color={blue}/><BeachHut x={193} color={teal}/>
    <g transform="translate(263 98) rotate(15)">
      <path d="M0-35Q18-17 9 25H-9Q-18-17 0-35Z" fill={pink}/>
      <path d="M0-30v52" stroke={cream} strokeWidth="3"/>
    </g>
    <path d="M9 137q28-7 51 0m226-3q24 7 55-3" stroke="#fffaf0" strokeWidth="3" fill="none" strokeLinecap="round"/>
    <path d="m144 136 6-3m5 8 6-3m37-9 6-3" stroke="#c1a47c" strokeWidth="2" strokeLinecap="round"/>
  </>
}

function Palm({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M0 0q9-29 4-67" fill="none" stroke="#9b704b" strokeWidth="7"/>
    <path d="M4-66q-32-15-40 12 19-11 40-12M4-66q30-20 44 2-25-4-44-2M4-66q-3-33-28-28 19 13 28 28M4-66q5-29 28-28-12 20-28 28M4-66q-18 3-18 24 15-13 18-24M4-66q19 0 23 23-17-8-23-23" fill={leaf}/>
  </g>
}

function PromenadeScene() {
  return <>
    <Cloud x={106} y={15}/><Sea horizon={74}/>
    <path d="M0 110h350v40H0Z" fill={sand}/>
    <path d="M0 103h350v10H0Z" fill={cream}/>
    <path d="M0 126h350m-301-13-19 37m91-37-8 37m91-37 6 37m80-37 17 37" stroke="#ddc19a" strokeWidth="2"/>
    <Palm x={74} y={124} scale={0.95}/><Palm x={282} y={113} scale={0.7}/>
    <g transform="translate(169 102)">
      <path d="M-32 4v22m58-22v22" stroke={blue} strokeWidth="4"/>
      <path d="M-39-12h75v7h-75Zm0 11h75v7h-75Z" fill={pink}/>
      <path d="M-42 9h81v6h-81Z" fill={blue}/>
      <path d="M-36-12v21m68-21v21" stroke={blue} strokeWidth="3"/>
    </g>
    <Birds x={176} y={53}/>
  </>
}

function WineScene() {
  return <>
    <Cloud x={45} y={20}/>
    <path d="m0 97 54-54 48 27 50-40 61 56 56-37 81 48v53H0Z" fill="#b5ccb8"/>
    <path d="M0 119q72-60 160-17t190-16v64H0Z" fill={green}/>
    <path d="m0 150 114-43m-57 43 78-39m-10 39 36-34m37 34-10-29m86 29-45-33m102 33-67-44" stroke={leaf} strokeWidth="8"/>
    <path d="M125 128h111v9H125Z" fill={mustard}/>
    <path d="M142 136v14m76-14v14" stroke="#9b704b" strokeWidth="5"/>
    <path d="M173 48h39l-3 37q-16 23-33 0Z" fill={cream}/>
    <path d="M177 68h31l-3 18q-13 14-25-1Z" fill="#bc3557"/>
    <path d="M193 96v30m-12 0h24" stroke={cream} strokeWidth="3" strokeLinecap="round"/>
    <path d="M182 54v9" stroke="#fffaf0" strokeWidth="3" strokeLinecap="round"/>
    <g fill={blue}>
      <circle cx="148" cy="106" r="6"/><circle cx="159" cy="107" r="6"/>
      <circle cx="144" cy="116" r="6"/><circle cx="155" cy="118" r="6"/><circle cx="149" cy="125" r="5"/>
    </g>
    <path d="M153 102q-14-1-18-13 19-2 18 13m0 0q9-17 18-13-3 13-18 13" fill={leaf}/>
    <Plant x={42} y={151} scale={0.7}/>
  </>
}

function CliffScene() {
  return <>
    <Cloud x={15} y={22}/><Sea horizon={80}/>
    <path d="M0 140 70 111l57-36 29-40 49 9 48 70 42 36H0Z" fill={green}/>
    <path d="m127 75 29-40 10 53-35 28-11 34H0l70-39Z" fill={leaf}/>
    <path d="m166 88 39-44 16 53 32 17-31 10-19 26h-83l11-34Z" fill="#a4b67c"/>
    <path d="m173 84 5 34-14 23m40-48 10 22m-64 4-10 22" stroke={cream} strokeWidth="2" opacity=".65" fill="none"/>
    <path d="M258 125q22 13 77 4m-310 9 41-14" fill="none" stroke={cream} strokeWidth="3" strokeLinecap="round"/>
    <Birds x={221} y={42}/><Plant x={60} y={146} scale={0.66}/>
  </>
}

function NotebookScene() {
  return <>
    <Cloud x={31} y={22}/>
    <ellipse cx="176" cy="127" rx="94" ry="12" fill={sand}/>
    <g transform="translate(160 76) rotate(-9)">
      <rect x="-43" y="-43" width="82" height="92" rx="7" fill={teal}/>
      <path d="M-31-38h63v82h-63Z" fill="#fffaf0"/>
      <path d="M-31-38v82" stroke={mustard} strokeWidth="4"/>
      <path d="M-46-26h12m-12 19h12m-12 19h12m-12 19h12" stroke={blue} strokeWidth="4" strokeLinecap="round"/>
      <path d="M-18 17H20M-18 27H7" stroke="#d1ddcf" strokeWidth="3" strokeLinecap="round"/>
      <path d="M15-14C15-4 0 7 0 7S-15-4-15-14a15 15 0 0 1 30 0Z" fill={pink}/>
      <circle cx="0" cy="-14" r="5" fill={cream}/>
    </g>
    <g transform="translate(220 84) rotate(21)">
      <path d="M-4-38h9v61l-5 12-4-12Z" fill={mustard}/>
      <path d="m-4 23 4 12 5-12Z" fill={sand}/>
      <path d="m-2 31 2 4 2-4Z" fill={ink}/>
      <path d="M-4-38h9v9h-9Z" fill={pink}/>
    </g>
    <Plant x={275} y={132} scale={0.7}/>
  </>
}

const scenes: Record<StampKind, ReactNode> = {
  mountain: <MountainScene/>,
  penguin: <PenguinScene/>,
  house: <HouseScene/>,
  cape: <CapeScene/>,
  lighthouse: <LighthouseScene/>,
  road: <RoadScene/>,
  boat: <HarborScene/>,
  huts: <HutsScene/>,
  promenade: <PromenadeScene/>,
  wine: <WineScene/>,
  cliff: <CliffScene/>,
  pin: <NotebookScene/>,
}

export function SceneIllustration({ kind, className }: { kind: StampKind; className: string }) {
  return <svg className={className} data-scene={kind} viewBox="0 0 350 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="350" height="150" fill={cream}/>
    <circle cx="283" cy="31" r="19" fill={mustard}/>
    {scenes[kind]}
  </svg>
}
