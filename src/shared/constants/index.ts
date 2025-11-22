export const isAsyncFunction = <T, R>(fn: (...params: T[]) => R) =>
  toString.call(fn) === '[object AsyncFunction]';

export const getOwnPropertyNames = <T extends object>(x: T) => {
  return [
    ...Object.getOwnPropertyNames(x),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(x)),
  ];
};

export const isClient = () => typeof document !== 'undefined';
export const isTest = () => import.meta.env.MODE === 'test';

// Define constants for entity types
export const ENTITY_TYPES = {
  TOOL: 'Tool',
  AGENT: 'Agent',
} as const;

// Define a type for localized strings
interface LocalizedStrings {
  en: string;
  [key: string]: string;
}

// Define the structure for agent/tool metadata
interface AgentMetaEntry {
  Name: LocalizedStrings;
  Description: LocalizedStrings;
  Type: typeof ENTITY_TYPES.TOOL | typeof ENTITY_TYPES.AGENT;
}

export const AGENT_META: Record<string, AgentMetaEntry> = {
  DATE_TIME_TOOL: {
    Name: {
      en: 'DateTime Tool',
    },
    Description: {
      en: 'A tool to get the current date and time. You can specify a `timezone` (e.g., "America/New_York") and a `format` (e.g., "YYYY-MM-DD HH:mm:ss"). If no timezone is provided, it defaults to UTC. If no format is provided, it returns the ISO 8601 format.',
    },
    Type: ENTITY_TYPES.TOOL,
  },
  LLM_CALL_TOOL: {
    Name: {
      en: 'LlmCall Tool',
    },
    Description: {
      en: 'A tool to perform a single call of Llm.',
    },
    Type: ENTITY_TYPES.TOOL,
  },
  REACT_AGENT: {
    Name: {
      en: 'ReAct Agent',
    },
    Description: {
      en: 'An agent that uses the ReAct strategy to interact with tools and provide answers based on reasoning and actions.',
    },
    Type: ENTITY_TYPES.AGENT,
  },
};
