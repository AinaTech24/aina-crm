import { requireOptionalNativeModule } from "expo-modules-core";
export interface SimCall { id: string; number: string; date: number; duration: number; type: number }
export default requireOptionalNativeModule<{ readCalls(since: number, until: number): Promise<SimCall[]> }>("AinaCallLog");
