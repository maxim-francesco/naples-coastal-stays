import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  listAllPropertiesAdmin,
  createProperty,
  updateProperty,
  deleteProperty,
  type DBProperty,
} from "@/lib/adminProperties.server";
import {
  Plus,
  Edit2,
  Trash2,
  LogOut,
  Loader2,
  ArrowUp,
  ArrowDown,
  X,
  Palmtree,
  Home,
  Bath,
  Bed,
  Users,
  DollarSign,
  Calendar,
  Layers,
  Image,
} from "lucide-react";
import { PhotoManagerDialog } from "@/components/admin/PhotoManagerDialog";
import { BookingInbox } from "@/components/admin/BookingInbox";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/admin/")({
  loader: async () => {
    const properties = await listAllPropertiesAdmin();
    return { properties };
  },
  component: AdminDashboard,
});

interface PropertyFormState {
  slug: string;
  name: string;
  area: string;
  short_description: string;
  long_description: string[];
  max_guests: number;
  bedrooms: number;
  bathrooms: number;
  min_nights: number;
  base_rate: number;
  cleaning_fee: number;
  amenities: string[];
  sort_order: number;
  is_active: boolean;
}

const defaultFormState: PropertyFormState = {
  slug: "",
  name: "",
  area: "",
  short_description: "",
  long_description: [],
  max_guests: 2,
  bedrooms: 1,
  bathrooms: 1,
  min_nights: 1,
  base_rate: 100,
  cleaning_fee: 50,
  amenities: [],
  sort_order: 10,
  is_active: true,
};

function ListEditor({
  label,
  items,
  onChange,
  placeholder,
  idPrefix,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  idPrefix: string;
}) {
  const handleItemChange = (index: number, val: string) => {
    const next = [...items];
    next[index] = val;
    onChange(next);
  };

  const handleAddItem = () => {
    onChange([...items, ""]);
  };

  const handleRemoveItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const next = [...items];
    const temp = next[index] as string;
    next[index] = next[index - 1] as string;
    next[index - 1] = temp;
    onChange(next);
  };

  const handleMoveDown = (index: number) => {
    if (index === items.length - 1) return;
    const next = [...items];
    const temp = next[index] as string;
    next[index] = next[index + 1] as string;
    next[index + 1] = temp;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={handleAddItem}
          className="text-[13px] font-medium text-primary hover:underline flex items-center gap-1 cursor-pointer"
        >
          <Plus size={14} /> Add line
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground italic bg-muted/50 rounded-lg p-3 text-center">
          No lines added yet. Click "Add line" to begin.
        </p>
      ) : (
        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 border border-dashed rounded-lg p-2 bg-muted/30">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <label htmlFor={`${idPrefix}-${index}`} className="sr-only">
                {label} Line {index + 1}
              </label>
              <input
                type="text"
                id={`${idPrefix}-${index}`}
                name={`${idPrefix}-${index}`}
                value={item}
                onChange={(e) => handleItemChange(index, e.target.value)}
                placeholder={placeholder || `Line ${index + 1}`}
                className="flex-1 min-h-[38px] rounded-[8px] bg-background border border-border px-3 text-[14px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleMoveUp(index)}
                  disabled={index === 0}
                  className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                  title="Move up"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveDown(index)}
                  disabled={index === items.length - 1}
                  className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                  title="Move down"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveItem(index)}
                  className="p-1.5 text-destructive hover:bg-destructive/10 rounded cursor-pointer"
                  title="Delete line"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminDashboard() {
  const { properties } = Route.useLoaderData();
  const { session, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/admin/login" });
    }
  }, [session, loading, navigate]);

  // Form states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [propertyToEdit, setPropertyToEdit] = useState<DBProperty | null>(null);
  const [activeTab, setActiveTab] = useState<"properties" | "bookings">("properties");
  const [form, setForm] = useState<PropertyFormState>(defaultFormState);
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Delete states
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Photo manager states
  const [photoManagerOpen, setPhotoManagerOpen] = useState(false);
  const [photoManagerPropertyId, setPhotoManagerPropertyId] = useState<string>("");
  const [photoManagerPropertyName, setPhotoManagerPropertyName] = useState<string>("");

  const handleOpenPhotoManager = (id: string, name: string) => {
    setPhotoManagerPropertyId(id);
    setPhotoManagerPropertyName(name);
    setPhotoManagerOpen(true);
  };

  const isEdit = !!propertyToEdit;

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Signed out successfully.");
      navigate({ to: "/admin/login" });
    } catch (err) {
      console.error(err);
      toast.error("Failed to sign out.");
    }
  };

  const handleOpenCreateForm = () => {
    setValidationError(null);
    setPropertyToEdit(null);
    setForm({
      ...defaultFormState,
      sort_order: properties.length ? Math.max(...properties.map((p) => p.sort_order)) + 10 : 10,
    });
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (property: DBProperty) => {
    setValidationError(null);
    setPropertyToEdit(property);
    setForm({
      slug: property.slug,
      name: property.name,
      area: property.area,
      short_description: property.short_description,
      long_description: property.long_description || [],
      max_guests: property.max_guests,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      min_nights: property.min_nights,
      base_rate: property.base_rate,
      cleaning_fee: property.cleaning_fee,
      amenities: property.amenities || [],
      sort_order: property.sort_order,
      is_active: property.is_active,
    });
    setIsFormOpen(true);
  };

  const handleConfirmDelete = (id: string, name: string) => {
    setDeleteId(id);
    setDeleteName(name);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await deleteProperty({
        data: { id: deleteId, accessToken: session?.access_token },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) {
        toast.success("Property deleted successfully");
        await router.invalidate();
        setDeleteId(null);
        setDeleteName(null);
      } else {
        toast.error(res.error || "Failed to delete property");
      }
    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred.");
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setSubmitting(true);

    // Client side slug regex validation on create
    if (!isEdit && !/^[a-z0-9-]+$/.test(form.slug)) {
      setValidationError("Slug must contain only lowercase letters, numbers, and hyphens.");
      setSubmitting(false);
      return;
    }

    try {
      const payload = {
        slug: form.slug.trim(),
        name: form.name.trim(),
        area: form.area.trim(),
        short_description: form.short_description.trim(),
        long_description: form.long_description.filter((p) => p.trim() !== ""),
        max_guests: Number(form.max_guests),
        bedrooms: Number(form.bedrooms),
        bathrooms: Number(form.bathrooms),
        min_nights: Number(form.min_nights),
        base_rate: Number(form.base_rate),
        cleaning_fee: Number(form.cleaning_fee),
        amenities: form.amenities.filter((a) => a.trim() !== ""),
        sort_order: Number(form.sort_order),
        is_active: form.is_active,
      };

      let res;
      if (isEdit && propertyToEdit) {
        res = await updateProperty({
          data: {
            id: propertyToEdit.id,
            input: payload,
            accessToken: session?.access_token,
          },
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
      } else {
        res = await createProperty({
          data: {
            ...payload,
            accessToken: session?.access_token,
          },
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
      }

      if (res.ok) {
        toast.success(isEdit ? "Property updated successfully" : "Property created successfully");
        await router.invalidate();
        setIsFormOpen(false);
      } else {
        setValidationError(res.error || "An error occurred.");
      }
    } catch (err: any) {
      setValidationError(err.message || "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const inputBase =
    "block w-full min-h-[44px] rounded-xl border border-border bg-background px-3.5 text-sm md:text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all";
  const labelBase = "block text-[12px] md:text-[13px] font-medium text-muted-foreground";

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-card/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-full bg-accent text-primary">
              <Palmtree className="size-4" />
            </span>
            <span className="font-display text-xl font-semibold tracking-tight text-foreground">
              Admin
            </span>
          </div>
          <button
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors cursor-pointer"
            style={{ minHeight: "44px" }}
          >
            <LogOut className="size-4 text-muted-foreground" />
            Sign out
          </button>
        </div>
      </header>

      {/* Main Body */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Tab Switcher */}
        <div className="flex border-b border-border mb-8">
          <button
            onClick={() => setActiveTab("properties")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all mr-6 cursor-pointer ${
              activeTab === "properties"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Properties
          </button>
          <button
            onClick={() => setActiveTab("bookings")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "bookings"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Booking Requests
          </button>
        </div>

        {activeTab === "properties" ? (
          <>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
              <div>
                <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
                  Properties
                </h1>
                <p className="text-muted-foreground mt-1 text-sm">
                  Manage your vacation rentals, pricing, and amenities.
                </p>
              </div>
              <button
                onClick={handleOpenCreateForm}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-all cursor-pointer"
                style={{ minHeight: "44px" }}
              >
                <Plus className="size-4" />
                Add property
              </button>
            </div>

            {/* Properties List */}
            {properties.length === 0 ? (
              <div className="text-center rounded-2xl border border-dashed border-border bg-card p-12">
                <Home className="mx-auto size-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-display text-lg font-medium text-foreground">No properties yet</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Get started by creating your first vacation rental property.
                </p>
                <button
                  onClick={handleOpenCreateForm}
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 cursor-pointer"
                  style={{ minHeight: "44px" }}
                >
                  <Plus className="size-4" />
                  Add property
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {properties.map((property) => (
                  <div
                    key={property.id}
                    className="rounded-2xl border border-border bg-card p-5 md:p-6 shadow-soft hover:shadow-lift transition-all flex flex-col md:flex-row gap-5 justify-between"
                  >
                    <div className="flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
                          {property.name}
                        </h2>
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted border border-border text-foreground">
                          {property.slug}
                        </span>
                        {property.is_active ? (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50">
                            Active
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-800/50">
                            Inactive
                          </span>
                        )}
                      </div>

                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground">{property.area}</span> &middot; {property.short_description}
                      </p>

                      {/* Facts Row */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-2 border-t border-border/50 text-xs">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <DollarSign className="size-3.5 text-primary shrink-0" />
                          <div>
                            <div className="font-medium text-foreground">${property.base_rate}/night</div>
                            <div className="text-[10px]">Base rate</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <DollarSign className="size-3.5 text-primary shrink-0" />
                          <div>
                            <div className="font-medium text-foreground">${property.cleaning_fee}</div>
                            <div className="text-[10px]">Cleaning fee</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Calendar className="size-3.5 text-primary shrink-0" />
                          <div>
                            <div className="font-medium text-foreground">
                              {property.min_nights} {property.min_nights === 1 ? "night" : "nights"}
                            </div>
                            <div className="text-[10px]">Min stay</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Users className="size-3.5 text-primary shrink-0" />
                          <div>
                            <div className="font-medium text-foreground">Sleeps {property.max_guests}</div>
                            <div className="text-[10px]">Max guests</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Bed className="size-3.5 text-primary shrink-0" />
                          <div>
                            <div className="font-medium text-foreground">
                              {property.bedrooms} BR / {property.bathrooms} BA
                            </div>
                            <div className="text-[10px]">Layout</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Layers className="size-3.5 text-primary shrink-0" />
                          <div>
                            <div className="font-medium text-foreground">Order: {property.sort_order}</div>
                            <div className="text-[10px]">Sort order</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2 border-t md:border-t-0 border-border/50 pt-4 md:pt-0 shrink-0 self-stretch md:self-center justify-end">
                      <button
                        onClick={() => handleOpenPhotoManager(property.id, property.name)}
                        className="flex-1 md:flex-initial inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-accent cursor-pointer"
                        style={{ minHeight: "44px" }}
                      >
                        <Image className="size-4 text-muted-foreground" />
                        Manage photos
                      </button>
                      <button
                        onClick={() => handleOpenEditForm(property)}
                        className="flex-1 md:flex-initial inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-accent cursor-pointer"
                        style={{ minHeight: "44px" }}
                      >
                        <Edit2 className="size-4 text-muted-foreground" />
                        Edit
                      </button>
                      <button
                        onClick={() => handleConfirmDelete(property.id, property.name)}
                        className="flex-1 md:flex-initial inline-flex items-center justify-center gap-1.5 rounded-xl border border-destructive/20 bg-destructive/5 hover:bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive cursor-pointer"
                        style={{ minHeight: "44px" }}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <BookingInbox accessToken={session?.access_token} properties={properties} />
        )}
      </main>

      {/* Add / Edit Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8">
          <DialogHeader>
            <DialogTitle className="text-xl md:text-2xl font-display font-bold tracking-tight">
              {isEdit ? `Edit Property: ${propertyToEdit?.name}` : "Create Property"}
            </DialogTitle>
            <DialogDescription className="text-xs md:text-sm text-muted-foreground">
              Fill out the details below. Required fields are marked with *.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 py-4">
            {validationError && (
              <div className="p-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl font-medium">
                {validationError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="prop-slug" className={labelBase}>ID (slug)*</label>
                <input
                  id="prop-slug"
                  name="slug"
                  type="text"
                  disabled={isEdit}
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  placeholder="e.g. palm-breeze-retreat"
                  required
                  className={`${inputBase} disabled:opacity-50 disabled:bg-muted`}
                />
                {!isEdit && (
                  <p className="text-[11px] text-muted-foreground leading-normal">
                    Must be unique, lowercase letters, numbers, and hyphens only.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="prop-name" className={labelBase}>Name*</label>
                <input
                  id="prop-name"
                  name="name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Palm Breeze Retreat"
                  required
                  className={inputBase}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="prop-area" className={labelBase}>Area*</label>
              <input
                id="prop-area"
                name="area"
                type="text"
                value={form.area}
                onChange={(e) => setForm({ ...form, area: e.target.value })}
                placeholder="e.g. Vanderbilt Beach"
                required
                className={inputBase}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="prop-short-description" className={labelBase}>Short Description*</label>
              <textarea
                id="prop-short-description"
                name="short_description"
                value={form.short_description}
                onChange={(e) => setForm({ ...form, short_description: e.target.value })}
                placeholder="Brief summary of the property..."
                required
                rows={2}
                className="block w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm md:text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-y min-h-[80px]"
              />
            </div>

            {/* Numeric Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="prop-max-guests" className={labelBase}>Max Guests*</label>
                <input
                  id="prop-max-guests"
                  name="max_guests"
                  type="number"
                  min="1"
                  required
                  value={form.max_guests}
                  onChange={(e) => setForm({ ...form, max_guests: parseInt(e.target.value) || 0 })}
                  className={inputBase}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="prop-bedrooms" className={labelBase}>Bedrooms*</label>
                <input
                  id="prop-bedrooms"
                  name="bedrooms"
                  type="number"
                  min="0"
                  required
                  value={form.bedrooms}
                  onChange={(e) => setForm({ ...form, bedrooms: parseInt(e.target.value) || 0 })}
                  className={inputBase}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="prop-bathrooms" className={labelBase}>Bathrooms*</label>
                <input
                  id="prop-bathrooms"
                  name="bathrooms"
                  type="number"
                  min="0"
                  step="0.5"
                  required
                  value={form.bathrooms}
                  onChange={(e) => setForm({ ...form, bathrooms: parseFloat(e.target.value) || 0 })}
                  className={inputBase}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="prop-min-nights" className={labelBase}>Min Nights*</label>
                <input
                  id="prop-min-nights"
                  name="min_nights"
                  type="number"
                  min="1"
                  required
                  value={form.min_nights}
                  onChange={(e) => setForm({ ...form, min_nights: parseInt(e.target.value) || 0 })}
                  className={inputBase}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="prop-base-rate" className={labelBase}>Base Rate ($)*</label>
                <input
                  id="prop-base-rate"
                  name="base_rate"
                  type="number"
                  min="0"
                  required
                  value={form.base_rate}
                  onChange={(e) => setForm({ ...form, base_rate: parseFloat(e.target.value) || 0 })}
                  className={inputBase}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="prop-cleaning-fee" className={labelBase}>Cleaning Fee ($)*</label>
                <input
                  id="prop-cleaning-fee"
                  name="cleaning_fee"
                  type="number"
                  min="0"
                  required
                  value={form.cleaning_fee}
                  onChange={(e) => setForm({ ...form, cleaning_fee: parseFloat(e.target.value) || 0 })}
                  className={inputBase}
                />
              </div>

              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <label htmlFor="prop-sort-order" className={labelBase}>Sort Order*</label>
                <input
                  id="prop-sort-order"
                  name="sort_order"
                  type="number"
                  required
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                  className={inputBase}
                />
              </div>

              <div className="flex items-center gap-3 pt-6 pl-1 col-span-2">
                <Switch
                  id="prop-is-active"
                  name="is_active"
                  checked={form.is_active}
                  onCheckedChange={(checked) => setForm({ ...form, is_active: checked })}
                />
                <label htmlFor="prop-is-active" className="text-sm font-medium text-foreground cursor-pointer select-none">
                  Is active / visible on storefront
                </label>
              </div>
            </div>

            {/* ListEditors */}
            <div className="space-y-4 pt-2 border-t border-border/50">
              <ListEditor
                label="Long Description (paragraphs)*"
                items={form.long_description}
                onChange={(items) => setForm({ ...form, long_description: items })}
                placeholder="Paragraph content..."
                idPrefix="prop-longdesc"
              />

              <ListEditor
                label="Amenities*"
                items={form.amenities}
                onChange={(items) => setForm({ ...form, amenities: items })}
                placeholder="e.g. Private Pool, Wi-Fi"
                idPrefix="prop-amenity"
              />
            </div>

            {/* Form actions */}
            <div className="flex items-center justify-end gap-3 pt-5 border-t border-border/50">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-accent cursor-pointer"
                style={{ minHeight: "44px" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold shadow-sm hover:opacity-90 disabled:opacity-50 cursor-pointer"
                style={{ minHeight: "44px" }}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : isEdit ? "Save Changes" : "Create Property"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent className="rounded-2xl max-w-md p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-bold">
              Are you absolutely sure?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              This will permanently delete the property <strong>{deleteName}</strong> and remove its data from the database. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel asChild>
              <button className="inline-flex items-center justify-center rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors cursor-pointer" style={{ minHeight: "44px" }}>
                Cancel
              </button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center justify-center rounded-xl bg-destructive text-destructive-foreground px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-colors cursor-pointer"
                style={{ minHeight: "44px" }}
              >
                {deleting ? "Deleting..." : "Delete Property"}
              </button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Photo Manager Dialog */}
      <PhotoManagerDialog
        isOpen={photoManagerOpen}
        onClose={() => setPhotoManagerOpen(false)}
        propertyId={photoManagerPropertyId}
        propertyName={photoManagerPropertyName}
        accessToken={session?.access_token}
      />
    </div>
  );
}
