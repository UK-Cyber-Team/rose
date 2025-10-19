import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  useGetServicesConfigQuery,
  useAddServiceMutation,
  useDeleteServiceMutation,
  useReloadServicesMutation,
  useCheckAuthStatusQuery,
} from "../api";

interface Service {
  name: string;
  ip: string;
  port: number;
}

export function Config() {
  const navigate = useNavigate();
  const { data: authStatus } = useCheckAuthStatusQuery();
  const { data: configData, isLoading, error, refetch } = useGetServicesConfigQuery();
  const [addService, { isLoading: isAdding }] = useAddServiceMutation();
  const [deleteService, { isLoading: isDeleting }] = useDeleteServiceMutation();
  const [reloadServices, { isLoading: isReloading }] = useReloadServicesMutation();

  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (authStatus && authStatus.auth_required && !authStatus.authenticated) {
      navigate("/");
    }
  }, [authStatus, navigate]);

  // Set default IP when config data loads
  useEffect(() => {
    if (configData?.vm_ip && !ip) {
      setIp(configData.vm_ip);
    }
  }, [configData]);

  const validateIPv4 = (ip: string): boolean => {
    const parts = ip.split(".");
    if (parts.length !== 4) return false;
    return parts.every((part) => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255 && part === num.toString();
    });
  };

  const validateIPv6 = (ip: string): boolean => {
    const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/;
    return ipv6Regex.test(ip);
  };

  const validateIP = (ip: string): boolean => {
    return validateIPv4(ip) || validateIPv6(ip);
  };

  const validatePort = (port: string): boolean => {
    const portNum = parseInt(port, 10);
    return !isNaN(portNum) && portNum >= 1 && portNum <= 65535 && port === portNum.toString();
  };

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    // Validation
    if (!name.trim()) {
      setMessage({ type: "error", text: "Service name is required" });
      return;
    }

    if (!validateIP(ip)) {
      setMessage({ type: "error", text: "Invalid IP address (must be valid IPv4 or IPv6)" });
      return;
    }

    if (!validatePort(port)) {
      setMessage({ type: "error", text: "Invalid port (must be between 1 and 65535)" });
      return;
    }

    try {
      await addService({
        name: name.trim(),
        ip: ip.trim(),
        port: parseInt(port, 10),
      }).unwrap();
      
      setMessage({ type: "success", text: `Service "${name}" added successfully` });
      setName("");
      setPort("");
      setIp(configData?.vm_ip || "");
      refetch();
    } catch (error: any) {
      setMessage({ type: "error", text: error?.data?.error || "Failed to add service" });
    }
  };

  const handleDeleteService = async (index: number, service: Service) => {
    if (!window.confirm(`Are you sure you want to delete "${service.name}" (${service.ip}:${service.port})?`)) {
      return;
    }

    try {
      await deleteService(index).unwrap();
      setMessage({ type: "success", text: `Service "${service.name}" deleted successfully` });
      refetch();
    } catch (error: any) {
      setMessage({ type: "error", text: error?.data?.error || "Failed to delete service" });
    }
  };

  const handleReloadServices = async () => {
    if (!window.confirm("This will reload the services configuration and attempt to rebuild the API container. Are you sure?")) {
      return;
    }

    try {
      const result = await reloadServices().unwrap();
      let messageText = result.warning || result.message || "Services reloaded successfully";
      if (result.warning && result.warning.includes("manually run")) {
        messageText += "\n\nRun this command on the host: docker compose up --build -d api";
      }
      setMessage({ 
        type: result.warning ? "error" : "success", 
        text: messageText
      });
      refetch();
    } catch (error: any) {
      const errorData = error?.data;
      let errorText = errorData?.error || "Failed to reload services";
      if (errorData?.manual_command) {
        errorText += `\n\nPlease run manually: ${errorData.manual_command}`;
      }
      setMessage({ type: "error", text: errorText });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-white dark:bg-gray-900">
        <div className="text-gray-900 dark:text-gray-100">Loading configuration...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-white dark:bg-gray-900">
        <div className="text-red-600 dark:text-red-400">Failed to load configuration</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 bg-white dark:bg-gray-900 min-h-screen">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-6">Service Configuration</h1>

        {message && (
          <div
            className={`p-4 mb-6 rounded-md ${
              message.type === "success"
                ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-100"
                : "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-100"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Add Service Form */}
        <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg shadow-md mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Add New Service</h2>
          <form onSubmit={handleAddService} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Service Name
                </label>
                <input
                  type="text"
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Web Service"
                />
              </div>
              <div>
                <label htmlFor="ip" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  IP Address
                </label>
                <input
                  type="text"
                  id="ip"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 10.10.3.1"
                />
              </div>
              <div>
                <label htmlFor="port" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Port
                </label>
                <input
                  type="number"
                  id="port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 8080"
                  min="1"
                  max="65535"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={isAdding}
              className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAdding ? "Adding..." : "Add Service"}
            </button>
          </form>
        </div>

        {/* Services Table */}
        <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg shadow-md">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Current Services</h2>
            <button
              onClick={handleReloadServices}
              disabled={isReloading}
              className="bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-white px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isReloading ? "Reloading..." : "Reload & Apply Changes"}
            </button>
          </div>
          
          {configData?.services && configData.services.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-3 px-4 text-gray-900 dark:text-gray-100 font-semibold">Name</th>
                    <th className="text-left py-3 px-4 text-gray-900 dark:text-gray-100 font-semibold">IP Address</th>
                    <th className="text-left py-3 px-4 text-gray-900 dark:text-gray-100 font-semibold">Port</th>
                    <th className="text-center py-3 px-4 text-gray-900 dark:text-gray-100 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {configData.services.map((service: Service, index: number) => (
                    <tr key={index} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700">
                      <td className="py-3 px-4 text-gray-900 dark:text-gray-100">{service.name}</td>
                      <td className="py-3 px-4 text-gray-900 dark:text-gray-100 font-mono">{service.ip}</td>
                      <td className="py-3 px-4 text-gray-900 dark:text-gray-100">{service.port}</td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleDeleteService(index, service)}
                          disabled={isDeleting}
                          className="bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white px-3 py-1 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-600 dark:text-gray-400 text-center py-8">No services configured yet.</p>
          )}
        </div>

        <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            <strong>Note:</strong> After adding or removing services, click "Reload & Apply Changes" to update the configuration. 
            The system will attempt to rebuild the API container automatically. If automatic rebuild fails, you'll need to run 
            <code className="mx-1 px-1 bg-yellow-100 dark:bg-yellow-800 rounded">docker compose up --build -d api</code> 
            manually on the host machine.
          </p>
        </div>
      </div>
    </div>
  );
}
