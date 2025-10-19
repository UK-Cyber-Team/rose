import { useState } from "react";
import { useGetFlowNotesQuery, useUpdateFlowNotesMutation } from "../api";

interface FlowNotesProps {
  flowId: string;
}

export function FlowNotes({ flowId }: FlowNotesProps) {
  const { data, isLoading } = useGetFlowNotesQuery(flowId);
  const [updateNotes, { isLoading: isSaving }] = useUpdateFlowNotesMutation();
  
  const [isEditing, setIsEditing] = useState(false);
  const [editedNotes, setEditedNotes] = useState("");
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const currentNotes = data?.notes || "";

  const handleEdit = () => {
    setEditedNotes(currentNotes);
    setIsEditing(true);
    setSaveMessage(null);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedNotes("");
    setSaveMessage(null);
  };

  const handleSave = async () => {
    try {
      await updateNotes({ flowId, notes: editedNotes }).unwrap();
      setSaveMessage({ type: "success", text: "Notes saved successfully" });
      setIsEditing(false);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error: any) {
      setSaveMessage({ 
        type: "error", 
        text: error?.data?.error || "Failed to save notes" 
      });
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gray-100 dark:bg-gray-800 p-2 text-black dark:text-white">
        <div className="font-extrabold text-black dark:text-white">Notes</div>
        <div className="pl-2 text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="bg-gray-100 dark:bg-gray-800 p-2 text-black dark:text-white">
      <div className="flex justify-between items-center mb-2">
        <div className="font-extrabold text-black dark:text-white">Notes</div>
        {!isEditing && (
          <button
            onClick={handleEdit}
            className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-3 py-1 rounded-md text-sm"
          >
            Edit
          </button>
        )}
      </div>

      {saveMessage && (
        <div
          className={`mb-2 p-2 rounded text-sm ${
            saveMessage.type === "success"
              ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-100"
              : "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-100"
          }`}
        >
          {saveMessage.text}
        </div>
      )}

      <div className="pl-2">
        {isEditing ? (
          <div>
            <textarea
              value={editedNotes}
              onChange={(e) => setEditedNotes(e.target.value)}
              className="w-full min-h-[100px] p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              placeholder="Add notes about this flow..."
              maxLength={10000}
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-white px-4 py-1 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={handleCancel}
                disabled={isSaving}
                className="bg-gray-600 hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600 text-white px-4 py-1 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              {editedNotes.length} / 10000 characters
            </div>
          </div>
        ) : (
          <div className="text-black dark:text-white whitespace-pre-wrap break-words">
            {currentNotes || (
              <span className="text-gray-500 dark:text-gray-400 italic">
                No notes yet. Click "Edit" to add notes about this flow.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
