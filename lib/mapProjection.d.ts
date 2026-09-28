export declare const MAP_VIEWBOX: { width: number; height: number };
export declare function project(lat: number, lng: number): [number, number];
export declare function unproject(x: number, y: number): { lat: number; lng: number };
