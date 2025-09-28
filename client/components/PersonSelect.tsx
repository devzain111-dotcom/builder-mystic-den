import { useState } from "react";
import { ChevronsUpDown, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export interface PersonOption { id: string; name: string; arrivalDate?: number }

export default function PersonSelect({ options, onSelect, placeholder = "ابحث عن الاسم..." }: { options: PersonOption[]; onSelect: (id: string) => void; placeholder?: string; }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
          <span className="flex items-center gap-2 text-muted-foreground"><UserSearch className="h-4 w-4"/> اختر اسماً</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50"/>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="end">
        <Command>
          <CommandInput placeholder={placeholder} autoFocus />
          <CommandEmpty>لا توجد نتائج</CommandEmpty>
          <CommandList>
            <CommandGroup>
              {options.map((p)=> (
                <CommandItem key={p.id} value={p.name} onSelect={() => { onSelect(p.id); setOpen(false); }}>
                  <div className="flex flex-col">
                    <span className="font-medium">{p.name}</span>
                    {p.arrivalDate ? (
                      <span className="text-xs text-muted-foreground">تاريخ الوصول: {new Date(p.arrivalDate).toLocaleDateString("ar-EG")}</span>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
