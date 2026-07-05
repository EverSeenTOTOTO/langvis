import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { ComponentType, ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import type { InlineControlProps } from './types';

type Renderer = ComponentType<InlineControlProps>;
type RendererMap = Map<string, Renderer>;

interface RegistryValue {
  get: (kind: string) => Renderer | null;
  register: (kind: string, comp: Renderer) => void;
  unregister: (kind: string) => void;
}

const RegistryContext = createContext<RegistryValue | null>(null);

type Action =
  | { type: 'register'; kind: string; comp: Renderer }
  | { type: 'unregister'; kind: string };

const reducer = (state: RendererMap, action: Action): RendererMap => {
  switch (action.type) {
    case 'register': {
      const next = new Map(state);
      next.set(action.kind, action.comp);
      return next;
    }
    case 'unregister': {
      if (!state.has(action.kind)) return state;
      const next = new Map(state);
      next.delete(action.kind);
      return next;
    }
    default:
      return state;
  }
};

/**
 * Holds the consumer-provided renderers (one per plugin `name`/kind) and makes them
 * available to every InlineControlNode via context. Rendered inside LexicalComposer
 * so decorator output (which lives in the composer subtree) can read it.
 */
export const InlineControlRegistryProvider: React.FC<{
  children: ReactNode;
}> = ({ children }) => {
  const [map, dispatch] = useReducer(
    reducer,
    undefined,
    () => new Map() as RendererMap,
  );

  const get = useCallback((kind: string) => map.get(kind) ?? null, [map]);
  const register = useCallback(
    (kind: string, comp: Renderer) =>
      dispatch({ type: 'register', kind, comp }),
    [],
  );
  const unregister = useCallback(
    (kind: string) => dispatch({ type: 'unregister', kind }),
    [],
  );

  const value = useMemo<RegistryValue>(
    () => ({ get, register, unregister }),
    [get, register, unregister],
  );

  return (
    <RegistryContext.Provider value={value}>
      {children}
    </RegistryContext.Provider>
  );
};

const useRegistry = (): RegistryValue => {
  const ctx = useContext(RegistryContext);
  if (!ctx) {
    throw new Error(
      'InlineControl plugin used outside <ChatInput> — InlineControlRegistryProvider is missing.',
    );
  }
  return ctx;
};

/**
 * Register a renderer under `kind` for the lifetime of the plugin. `comp` is read
 * through a ref so an unstable identity (e.g. inline arrow) does not thrash the
 * registry on every parent render; pass a stable component for best results.
 */
export const useRegisterRenderer = (kind: string, comp: Renderer): void => {
  const { register, unregister } = useRegistry();
  const compRef = useRef<Renderer>(comp);
  compRef.current = comp;

  useEffect(() => {
    // Stable wrapper that always reads the latest renderer from the ref.
    const Stable: Renderer = props => {
      const Current = compRef.current;
      return <Current {...props} />;
    };
    register(kind, Stable);
    return () => unregister(kind);
  }, [kind, register, unregister]);
};

/** Rendered by InlineControlNode.decorate(); resolves the renderer from the registry. */
export const InlineControlHost: React.FC<{
  nodeKey: string;
  kind: string;
  text: string;
  data?: unknown;
  editor: ReturnType<typeof useLexicalComposerContext>[0];
}> = ({ nodeKey, kind, text, data, editor }) => {
  const { get } = useRegistry();
  const Comp = get(kind);
  if (!Comp) {
    // Renderer not registered yet (timing) or plugin unmounted — degrade to plain text.
    return <span>{text}</span>;
  }
  return (
    <Comp
      kind={kind}
      text={text}
      data={data}
      nodeKey={nodeKey}
      editor={editor}
    />
  );
};
