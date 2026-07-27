import { useEffect, useState } from 'react';
import type { TodoItem } from '../../../shared/types';

export const useTodos = (): TodoItem[] => {
  const [todos, setTodos] = useState<TodoItem[]>([]);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getTodos().then((next) => {
      if (mounted) {
        setTodos(next);
      }
    });
    const offTodos = window.eyeProtect.onTodosChanged(setTodos);
    return () => {
      mounted = false;
      offTodos();
    };
  }, []);

  return todos;
};
